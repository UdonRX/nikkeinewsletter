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
      return NextResponse.json({
        title,
        imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
        contentHtml: textToHtml(structured.body),
        url: finalUrl.toString(),
        available: true,
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
    const contentHtml = source ? sanitizeBodyHtml(source.innerHTML, finalUrl.toString()) : "";

    if (contentHtml && (source?.textContent?.trim().length || 0) >= 120) {
      return NextResponse.json({
        title,
        imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
        contentHtml,
        url: finalUrl.toString(),
        available: true,
        source: "nikkei_article_body",
      });
    }

    return NextResponse.json({
      title,
      imageUrl: imageUrl ? new URL(imageUrl, finalUrl).toString() : "",
      contentHtml: textToHtml(fallbackBody),
      url: finalUrl.toString(),
      available: Boolean(fallbackBody),
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
