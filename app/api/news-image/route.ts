import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedHost(hostname: string) {
  const h = hostname.toLowerCase();
  return h === "nikkei.com" || h.endsWith(".nikkei.com");
}

function pickImage(doc: Document) {
  return (
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ||
    doc.querySelector('meta[property="og:image:url"]')?.getAttribute("content") ||
    ""
  );
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new NextResponse("url_required", { status: 400 });

  let articleUrl: URL;
  try { articleUrl = new URL(raw); }
  catch { return new NextResponse("invalid_url", { status: 400 }); }

  if (articleUrl.protocol !== "https:" || !allowedHost(articleUrl.hostname)) {
    return new NextResponse("unsupported_url", { status: 400 });
  }

  try {
    const page = await fetch(articleUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
        "Referer": "https://www.nikkei.com/",
      },
      cache: "no-store",
    });

    if (!page.ok) return new NextResponse("article_fetch_failed", { status: 502 });

    const finalArticleUrl = new URL(page.url || articleUrl.toString());
    if (!allowedHost(finalArticleUrl.hostname)) return new NextResponse("bad_redirect", { status: 400 });

    const html = await page.text();
    const doc = new JSDOM(html).window.document;
    const rawImage = pickImage(doc);
    if (!rawImage) return new NextResponse("image_not_found", { status: 404 });

    const imageUrl = new URL(rawImage, finalArticleUrl);
    if (imageUrl.protocol !== "https:" || !allowedHost(imageUrl.hostname)) {
      return new NextResponse("unsupported_image_host", { status: 400 });
    }

    const image = await fetch(imageUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": finalArticleUrl.toString(),
      },
      cache: "no-store",
    });

    if (!image.ok) return new NextResponse("image_fetch_failed", { status: 502 });

    const finalImageUrl = new URL(image.url || imageUrl.toString());
    if (!allowedHost(finalImageUrl.hostname)) return new NextResponse("bad_image_redirect", { status: 400 });

    const type = image.headers.get("content-type") || "image/jpeg";
    if (!type.toLowerCase().startsWith("image/")) return new NextResponse("not_image", { status: 502 });

    return new NextResponse(await image.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (e) {
    console.error("[api/news-image]", e);
    return new NextResponse("image_fetch_failed", { status: 502 });
  }
}
