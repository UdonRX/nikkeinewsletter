import { NextRequest, NextResponse } from "next/server";
import { getRefreshToken } from "@/lib/session";
import { JSDOM } from "jsdom";

function allowedHost(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "nikkei.com" || h.endsWith(".nikkei.com");
}

function sanitizeArticleHtml(html: string, baseUrl: string) {
  const dom = new JSDOM(`<main>${html}</main>`);
  const doc = dom.window.document;
  for (const el of Array.from(doc.querySelectorAll("script,style,noscript,nav,header,footer,aside,form,iframe,video,svg"))) el.remove();
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "srcdoc") el.removeAttribute(attr.name);
      if (name === "href" || name === "src") {
        if (/^javascript:/i.test(value)) el.removeAttribute(attr.name);
        else { try { el.setAttribute(attr.name, new URL(value, baseUrl).toString()); } catch { el.removeAttribute(attr.name); } }
      }
    }
  }
  return doc.querySelector("main")?.innerHTML || "";
}

export async function GET(req: NextRequest) {
  if (!(await getRefreshToken())) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) return NextResponse.json({ error: "url_required" }, { status: 400 });
  let url: URL;
  try { url = new URL(rawUrl); } catch { return NextResponse.json({ error: "invalid_url" }, { status: 400 }); }
  if (!allowedHost(url.hostname)) return NextResponse.json({ error: "unsupported_url" }, { status: 400 });
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8" },
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: `article_fetch_${response.status}` }, { status: 502 });
    const finalUrl = new URL(response.url || url.toString());
    if (!allowedHost(finalUrl.hostname)) return NextResponse.json({ error: "redirected_outside_nikkei" }, { status: 400 });
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.querySelector("h1")?.textContent?.trim() || doc.title || "";
    const imageUrl = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
    const candidates = [doc.querySelector('[itemprop="articleBody"]'), doc.querySelector("article"), doc.querySelector(".article-body"), doc.querySelector(".articleBody"), doc.querySelector("main")].filter(Boolean) as Element[];
    const source = candidates.sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];
    const contentHtml = source ? sanitizeArticleHtml(source.innerHTML, finalUrl.toString()) : "";
    return NextResponse.json({ title, imageUrl, contentHtml, url: finalUrl.toString(), available: Boolean(contentHtml) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "article_fetch_failed" }, { status: 502 });
  }
}