import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedHost(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "nikkei.com" || h.endsWith(".nikkei.com");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function textToHtml(text: string) {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => "<p>" + escapeHtml(line) + "</p>").join("");
}

function jsonLdArticle(doc: Document) {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const raw = JSON.parse(script.textContent || "");
      const list = Array.isArray(raw) ? raw : raw["@graph"] || [raw];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : String(item["@type"] || "");
        if (/NewsArticle|Article/i.test(type) && typeof item.articleBody === "string") {
          const image = Array.isArray(item.image) ? item.image[0] : item.image;
          return {
            body: item.articleBody,
            image: typeof image === "string" ? image : image?.url || "",
            headline: typeof item.headline === "string" ? item.headline : "",
          };
        }
      }
    } catch {}
  }
  return null;
}

function detectPaywallText(text: string) {
  return /この記事は有料会員限定(?:記事)?(?:です|記事です)?|有料会員登録をすることで閲覧できます|有料会員限定/.test(text);
}

function trimPaywallHtml(html: string): { html: string; paywalled: boolean } {
  const dom = new JSDOM("<main>" + html + "</main>");
  const root = dom.window.document.querySelector("main");
  if (!root) return { html, paywalled: detectPaywallText(html) };

  const markers = [
    "この記事は有料会員限定記事です",
    "この記事は有料会員限定です",
    "有料会員登録をすることで閲覧できます",
    "有料会員限定",
  ];

  for (const el of Array.from(root.querySelectorAll("*"))) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() || "";
    if (!text || !markers.some((marker) => text.includes(marker))) continue;

    let target = el;
    while (target.parentElement && target.parentElement !== root) {
      target = target.parentElement;
    }

    // 有料会員案内が出た要素以降を全部切る。
    let node: ChildNode | null = target;
    while (node) {
      const next = node.nextSibling;
      node.remove();
      node = next;
    }
    return { html: root.innerHTML, paywalled: true };
  }

  return { html: root.innerHTML, paywalled: false };
}

function trimPaywallText(text: string): { text: string; paywalled: boolean } {
  const markers = [
    "この記事は有料会員限定記事です",
    "この記事は有料会員限定です",
    "有料会員登録をすることで閲覧できます",
    "有料会員限定",
  ];
  const positions = markers.map((marker) => text.indexOf(marker)).filter((index) => index >= 0);
  if (!positions.length) return { text, paywalled: false };
  return { text: text.slice(0, Math.min(...positions)).trim(), paywalled: true };
}

function sanitizeBodyHtml(html: string, baseUrl: string) {
  const dom = new JSDOM("<main>" + html + "</main>");
  const doc = dom.window.document;

  const removeSelectors = [
    "script","style","noscript","nav","header","footer","aside","form","iframe","video","svg",
    "[class*='share']","[id*='share']","[class*='social']","[id*='social']",
    "[class*='recommend']","[id*='recommend']","[class*='related']","[id*='related']",
    "[class*='comment']","[id*='comment']","[class*='button']","[id*='button']",
    "[class*='login']","[id*='login']","[class*='membership']","[id*='membership']",
    "[class*='paywall']","[id*='paywall']"
  ];

  for (const el of Array.from(doc.querySelectorAll(removeSelectors.join(",")))) el.remove();

  // Nikkei本文内に混ざるThink!、記事利用サービス、関連企業などの案内も除外する。
  const unwantedText = [
    "Think!多様な観点からニュースを考える",
    "Think! の投稿を読む",
    "日経の記事利用サービスについて",
    "企業での記事共有や会議資料への転載・複製",
    "関連企業・業界",
    "コメントメニュー",
    "この投稿は現在非表示に設定されています",
    "Think! の投稿を読む",
  ];
  for (const el of Array.from(doc.querySelectorAll("div,section,aside,li,p"))) {
    const text = el.textContent?.replace(/\s+/g, " ").trim() || "";
    if (text && unwantedText.some((phrase) => text.includes(phrase))) el.remove();
  }

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "srcdoc") {
        el.removeAttribute(attr.name);
        continue;
      }
      if (name === "href" || name === "src") {
        if (/^javascript:/i.test(value)) el.removeAttribute(attr.name);
        else {
          try { el.setAttribute(attr.name, new URL(value, baseUrl).toString()); }
          catch { el.removeAttribute(attr.name); }
        }
      }
    }
  }

  return doc.querySelector("main")?.innerHTML || "";
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  const fallbackTitle = req.nextUrl.searchParams.get("title") || "";
  const fallbackBody = req.nextUrl.searchParams.get("body") || "";

  if (!rawUrl) return NextResponse.json({ error: "url_required" }, { status: 400 });

  let url: URL;
  try { url = new URL(rawUrl); }
  catch { return NextResponse.json({ error: "invalid_url" }, { status: 400 }); }

  if (url.protocol !== "https:" || !allowedHost(url.hostname)) {
    return NextResponse.json({ error: "unsupported_url" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
        "Referer": "https://www.nikkei.com/",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({
        title: fallbackTitle,
        imageUrl: "",
        contentHtml: textToHtml(fallbackBody),
        url: url.toString(),
        available: Boolean(fallbackBody),
        paywalled: false,
        source: "newsletter_fallback",
      });
    }

    const finalUrl = new URL(response.url || url.toString());
    if (!allowedHost(finalUrl.hostname)) {
      return NextResponse.json({
        title: fallbackTitle,
        imageUrl: "",
        contentHtml: textToHtml(fallbackBody),
        url: url.toString(),
        available: Boolean(fallbackBody),
        source: "newsletter_fallback",
      });
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
    const structured = jsonLdArticle(doc);

    const title = structured?.headline || ogTitle || doc.querySelector("h1")?.textContent?.trim() || fallbackTitle;
    const imageUrl = structured?.image || ogImage || "";

    if (structured?.body) {
      const structuredBody = trimPaywallText(structured.body);
      return NextResponse.json({
        title,
        imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
        contentHtml: textToHtml(structuredBody.text),
        url: finalUrl.toString(),
        available: true,
        paywalled: structuredBody.paywalled,
        source: "nikkei_structured_data",
      });
    }

    const candidates = [
      doc.querySelector('[itemprop="articleBody"]'),
      doc.querySelector(".article-body"),
      doc.querySelector(".articleBody"),
      doc.querySelector('[class*="article-body"]'),
      doc.querySelector('[class*="articleBody"]'),
      doc.querySelector("article"),
    ].filter(Boolean) as Element[];

    const source = candidates.sort((a,b)=>(b.textContent?.trim().length||0)-(a.textContent?.trim().length||0))[0];
    const sanitizedHtml = source ? sanitizeBodyHtml(source.innerHTML, finalUrl.toString()) : "";
    const trimmed = trimPaywallHtml(sanitizedHtml);
    const contentHtml = trimmed.html;

    if (contentHtml && (source?.textContent?.trim().length || 0) >= 120) {
      return NextResponse.json({
        title,
        imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
        contentHtml,
        url: finalUrl.toString(),
        available: true,
        paywalled: trimmed.paywalled,
        source: "nikkei_article_body",
      });
    }

    return NextResponse.json({
      title,
      imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
      contentHtml: textToHtml(fallbackBody),
      url: finalUrl.toString(),
      available: Boolean(fallbackBody),
      paywalled: false,
      source: "newsletter_fallback",
    });
  } catch {
    return NextResponse.json({
      title: fallbackTitle,
      imageUrl: "",
      contentHtml: textToHtml(fallbackBody),
      url: url.toString(),
      available: Boolean(fallbackBody),
      source: "newsletter_fallback",
    });
  }
}
