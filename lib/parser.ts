import { JSDOM } from "jsdom";

export type ParsedNews = {
  title: string;
  body: string;
  url?: string;
  index: number;
  section?: string;
  imageUrl?: string;
  imageAlt?: string;
};

const NOISE =
  /配信停止|配信解除|unsubscribe|お問い合わせ|プライバシー|日経電子版について|Copyright|facebook|twitter|x\.com|instagram|iOS|Android|アカウント一覧|NIKKEIニュースレター|このメールは送信専用/i;

const SECTION =
  /^(注目ニュース|特報|マーケット|ニュース解説|連載・コラム|Visual & Podcast|Notice|セクション|オピニオン|経済|政治|ビジネス|金融|マネーのまなび|テック|国際|スポーツ|社会・調査|地域|文化|ライフスタイル|おすすめ映像|BUSINESS DAILY)$/;

const URL_OK = /^https?:\/\/(?:[^\s"'<>]*\.)?nikkei\.com\//i;

function clean(s: string) {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function validTitle(s: string) {
  return s.length >= 8 && s.length <= 140 && !NOISE.test(s) && !SECTION.test(s);
}

function visibleText(el: Element) {
  return clean(el.textContent || "");
}

function imageCandidate(img: Element, baseUrl?: string) {
  const raw =
    img.getAttribute("src") ||
    img.getAttribute("data-src") ||
    img.getAttribute("data-original") ||
    img.getAttribute("data-lazy-src") ||
    img.getAttribute("data-fallback-src") ||
    "";

  const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
  const bestSrc = raw || srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";

  if (!bestSrc || bestSrc.startsWith("data:")) return null;

  const width = Number(img.getAttribute("width") || "0");
  const height = Number(img.getAttribute("height") || "0");
  if ((width > 0 && width < 80) || (height > 0 && height < 50)) return null;
  if (/spacer|tracking|pixel|logo|icon|blank/i.test(bestSrc)) return null;

  try {
    return {
      src: bestSrc.startsWith("/") ? bestSrc : new URL(bestSrc, baseUrl || "https://www.nikkei.com/").toString(),
      alt: clean(img.getAttribute("alt") || ""),
    };
  } catch {
    return null;
  }
}

function imageFromBlock(el: Element, baseUrl?: string) {
  for (const img of Array.from(el.querySelectorAll("img"))) {
    const found = imageCandidate(img, baseUrl);
    if (found) return found;
  }
  return null;
}

function imageNearAnchor(a: Element, baseUrl: string) {
  const direct = imageFromBlock(a, baseUrl);
  if (direct) return direct;

  const td = a.closest("td");
  if (td) {
    const found = imageFromBlock(td, baseUrl);
    if (found) return found;
  }

  const tr = a.closest("tr");
  if (tr) {
    const found = imageFromBlock(tr, baseUrl);
    if (found) return found;
  }

  let node: Element | null = a;
  for (let i = 0; i < 5 && node?.parentElement; i++) {
    node = node.parentElement;
    const imgs = Array.from(node.querySelectorAll("img"));
    if (imgs.length <= 8) {
      const found = imageFromBlock(node, baseUrl);
      if (found) return found;
    }
  }

  const parent = a.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(a);
    for (const offset of [-1, 1, -2, 2]) {
      const sibling = siblings[index + offset];
      if (!sibling) continue;
      const found = imageFromBlock(sibling, baseUrl);
      if (found) return found;
    }
  }

  return null;
}

export function parseNikkeiEmail(html: string, textFallback: string): ParsedNews[] {
  if (!html) return parseText(textFallback);

  const doc = new JSDOM(html).window.document;

  for (const el of Array.from(doc.querySelectorAll("script,style,noscript,form,svg"))) {
    el.remove();
  }

  const out: ParsedNews[] = [];
  const seen = new Set<string>();
  let section = "";

  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") || "";
    const title = visibleText(a);

    if (!URL_OK.test(href) || !validTitle(title)) continue;

    let block: Element = a;

    for (let i = 0; i < 6 && block.parentElement; i++) {
      const parent = block.parentElement;
      const text = visibleText(parent);
      if (text.length > title.length && text.length <= 700) block = parent;
      else break;
    }

    const raw = visibleText(block);
    const lines = (block.textContent || "").split(/\r?\n/).map(clean).filter(Boolean);
    const sectionCandidate = lines.find((x) => SECTION.test(x));
    if (sectionCandidate) section = sectionCandidate;

    const image = imageNearAnchor(a, href);

    const body = clean(
      raw.replace(title, "").replace(
        /特報|ニュース解説|連載・コラム|Visual & Podcast|Notice|おすすめ映像|BUSINESS DAILY/g,
        " "
      )
    );

    const key = href + "|" + title;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({
      index: out.length,
      title,
      body,
      url: href,
      section: section || undefined,
      imageUrl: image?.src,
      imageAlt: image?.alt,
    });
  }

  return out.slice(0, 150);
}

function parseText(t: string): ParsedNews[] {
  const lines = t.split(/\r?\n/).map(clean).filter(Boolean);
  const out: ParsedNews[] = [];
  let section = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION.test(line)) {
      section = line;
      continue;
    }
    if (!validTitle(line)) continue;

    const next = clean(lines[i + 1] || "");
    const hasSummary = next.length >= 25 && !SECTION.test(next) && !validTitle(next);

    out.push({
      index: out.length,
      title: line,
      body: hasSummary ? next : "",
      section: section || undefined,
    });
  }

  return out.slice(0, 150);
}
