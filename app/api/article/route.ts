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

function sanitizeArticleHtml(html: string, baseUrl: string) {
  const dom = new JSDOM("<main>" + html + "</main>");
  const doc = dom.window.document;
  for (const el of Array.from(doc.querySelectorAll("script,style,noscript,nav,header,footer,aside,form,iframe,video,svg"))) el.remove();

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
        fetchError: "article_fetch_" + response.status,
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
        fetchError: "redirected_outside_nikkei",
      });
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const title =
      doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.querySelector("h1")?.textContent?.trim() ||
      doc.title ||
      fallbackTitle;

    const imageUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";

    const candidates = [
      doc.querySelector('[itemprop="articleBody"]'),
      doc.querySelector("article"),
      doc.querySelector(".article-body"),
      doc.querySelector(".articleBody"),
      doc.querySelector('[class*="article-body"]'),
      doc.querySelector('[class*="articleBody"]'),
      doc.querySelector("main"),
    ].filter(Boolean) as Element[];

    const source = candidates.sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];
    const contentHtml = source ? sanitizeArticleHtml(source.innerHTML, finalUrl.toString()) : "";

    if (!contentHtml || (source?.textContent?.trim().length || 0) < 120) {
      return NextResponse.json({
        title,
        imageUrl,
        contentHtml: textToHtml(fallbackBody),
        url: finalUrl.toString(),
        available: Boolean(fallbackBody),
        source: "newsletter_fallback",
        fetchError: "article_body_not_found",
      });
    }

    return NextResponse.json({ title, imageUrl, contentHtml, url: finalUrl.toString(), available: true, source: "nikkei" });
  } catch (e) {
    return NextResponse.json({
      title: fallbackTitle,
      imageUrl: "",
      contentHtml: textToHtml(fallbackBody),
      url: url.toString(),
      available: Boolean(fallbackBody),
      source: "newsletter_fallback",
      fetchError: e instanceof Error ? e.message : "article_fetch_failed",
    });
  }
}
