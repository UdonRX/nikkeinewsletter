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

const URL_OK =
  /^https?:\/\/(?:[^\s"']*\.)?nikkei\.com\//i;

function clean(s: string) {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function validTitle(s: string) {
  const n = s.length;
  return n >= 8 && n <= 140 && !NOISE.test(s) && !SECTION.test(s);
}

function visibleText(el: Element) {
  return clean(el.textContent || "");
}

function imageFromBlock(el: Element) {
  const images = Array.from(el.querySelectorAll("img[src]"));
  for (const img of images) {
    const src = img.getAttribute("src") || "";
    const width = Number(img.getAttribute("width") || "0");
    const height = Number(img.getAttribute("height") || "0");
    if (!src || src.startsWith("data:") || src.startsWith("cid:")) continue;
    if ((width > 0 && width < 80) || (height > 0 && height < 50)) continue;
    if (/spacer|tracking|pixel|logo|icon/i.test(src)) continue;
    return { src, alt: clean(img.getAttribute("alt") || "") };
  }
  return null;
}

/**
 * 日経9/24昼版サンプルから確定した基本ルール:
 * - 「注目ニュース」「マーケット」等は記事ではなくセクション見出し。
 * - nikkei.comへのリンク1個を1記事の主キーにする。
 * - リンク文字列をタイトルにする。
 * - 同じリンクを含む近い親要素から本文を取得する。
 * - 「特報」のようなラベルは本文から除外する。
 * - URLが取れないPDF/text fallbackでは、タイトル列を記事として扱い本文/URLは空にする。
 *
 * メールHTMLそのもののDOMはPDFから復元できないため、CSSセレクタ固定ではなく
 * 上記ルールでDOM変更に強くしている。
 */
export function parseNikkeiEmail(
  html: string,
  textFallback: string
): ParsedNews[] {
  if (!html) return parseText(textFallback);

  const doc = new JSDOM(html).window.document;

  for (const el of Array.from(
    doc.querySelectorAll("script,style,noscript,form,svg")
  )) {
    el.remove();
  }

  const out: ParsedNews[] = [];
  const seen = new Set<string>();
  let section = "";

  const anchors = Array.from(doc.querySelectorAll("a[href]"));

  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    const title = visibleText(a);

    if (!URL_OK.test(href) || !validTitle(title)) continue;

    let block: Element = a;

    for (let i = 0; i < 6 && block.parentElement; i++) {
      const parent = block.parentElement;
      const text = visibleText(parent);

      if (text.length > title.length && text.length <= 700) {
        block = parent;
      } else {
        break;
      }
    }

    const raw = visibleText(block);
    const lines = (block.textContent || "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

    const sectionCandidate = lines.find((x) => SECTION.test(x));
    if (sectionCandidate) section = sectionCandidate;

    let image = imageFromBlock(block);
    if (!image && block.parentElement) image = imageFromBlock(block.parentElement);

    const body = clean(
      raw
        .replace(title, "")
        .replace(
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
  const lines = t
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

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
    const hasSummary =
      next.length >= 25 && !SECTION.test(next) && !validTitle(next);

    out.push({
      index: out.length,
      title: line,
      body: hasSummary ? next : "",
      section: section || undefined,
    });
  }

  return out.slice(0, 150);
}
