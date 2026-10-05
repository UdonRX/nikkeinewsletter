import { JSDOM } from "jsdom";

export type ParsedNews = {
  title: string;
  body: string;
  url?: string;
  index: number;
  section?: string;
  imageUrl?: string;
  imageAlt?: string;
  publishedAt?: string;
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

function tokyoDateParts(value: string | undefined) {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(safe);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value || safe.getFullYear()),
    month: Number(parts.find((p) => p.type === "month")?.value || safe.getMonth() + 1),
    day: Number(parts.find((p) => p.type === "day")?.value || safe.getDate()),
  };
}

function toIsoTokyo(year: number, month: number, day: number, hour: number, minute: number) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  const value = new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

function extractPublishedAt(text: string, baseDate?: string) {
  const normalized = clean(text).replace(/\u3000/g, " ");
  if (!normalized) return undefined;
  const base = tokyoDateParts(baseDate);

  const labeled = normalized.match(/(?:公開|掲載|配信|更新|投稿|発信)[^\\d]{0,12}(20\\d{2}[年\\/-])?(\\d{1,2})[月\\/-](\\d{1,2})日?[^\\d]{0,12}(\\d{1,2}):(\\d{2})/);
  if (labeled) {
    const year = labeled[1] ? Number(labeled[1].replace(/[^0-9]/g, "")) : base.year;
    const iso = toIsoTokyo(year, Number(labeled[2]), Number(labeled[3]), Number(labeled[4]), Number(labeled[5]));
    if (iso) return iso;
  }

  const labeledTime = normalized.match(/(?:公開|掲載|配信|更新|投稿|発信)[^\\d]{0,20}(\\d{1,2}):(\\d{2})/);
  if (labeledTime) {
    const iso = toIsoTokyo(base.year, base.month, base.day, Number(labeledTime[1]), Number(labeledTime[2]));
    if (iso) return iso;
  }

  const fullDatePatterns = [
    /(20\d{2})[年\/.-](\d{1,2})[月\/.-](\d{1,2})日?[^\d]{0,16}(\d{1,2}):(\d{2})/,
    /(\d{1,2})月(\d{1,2})日[^\d]{0,16}(\d{1,2}):(\d{2})/,
    /(\d{1,2})[\/.-](\d{1,2})[^\d]{0,16}(\d{1,2}):(\d{2})/,
  ];

  for (const pattern of fullDatePatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    if (match.length === 6) {
      const iso = toIsoTokyo(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]));
      if (iso) return iso;
    } else {
      const iso = toIsoTokyo(base.year, Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]));
      if (iso) return iso;
    }
  }

  const timeMatches = [...normalized.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g)];
  if (timeMatches.length === 1) {
    return toIsoTokyo(base.year, base.month, base.day, Number(timeMatches[0][1]), Number(timeMatches[0][2]));
  }
  return undefined;
}

export function parseNikkeiEmail(html: string, textFallback: string, baseDate?: string): ParsedNews[] {
  const started = Date.now();
  if (!html) {
    const out = parseText(textFallback, baseDate);
    console.log("[GMAIL_PARSE] TEXT_FALLBACK", {
      htmlParseMs: 0,
      articleExtractionMs: Date.now() - started,
      totalMs: Date.now() - started,
      articleCount: out.length,
    });
    return out;
  }

  const htmlParseStarted = Date.now();
  const doc = new JSDOM(html).window.document;
  const htmlParseMs = Date.now() - htmlParseStarted;

  const cleanupStarted = Date.now();
  for (const el of Array.from(doc.querySelectorAll("script,style,noscript,form,svg"))) {
    el.remove();
  }
  const cleanupMs = Date.now() - cleanupStarted;

  const extractionStarted = Date.now();
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

    const normalizedTitle = title.replace(/[「」『』【】（）()［］\[\]・:：、,.，．!！?？\s]/g, "").toLowerCase();
    const key = normalizedTitle;
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
      publishedAt: extractPublishedAt(raw, baseDate),
    });
  }

  const result = out.slice(0, 150);
  console.log("[GMAIL_PARSE] HTML", {
    htmlParseMs,
    cleanupMs,
    articleExtractionMs: Date.now() - extractionStarted,
    totalMs: Date.now() - started,
    articleCount: result.length,
  });
  return result;
}

function parseText(t: string, baseDate?: string): ParsedNews[] {
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
      publishedAt: extractPublishedAt([line, next].join(" "), baseDate),
    });
  }

  return out.slice(0, 150);
}
