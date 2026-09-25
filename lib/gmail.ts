import iconv from "iconv-lite";
import { gmailClient } from "./google";

function decodeBase64Url(s: string, charset = "utf-8") {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(normalized, "base64");
  try {
    return iconv.decode(bytes, normalizeCharset(charset));
  } catch {
    return iconv.decode(bytes, "utf-8");
  }
}

function normalizeCharset(value: string) {
  const v = value.toLowerCase().replace(/["']/g, "").trim();
  if (v === "shift_jis" || v === "shift-jis" || v === "sjis" || v === "x-sjis") return "cp932";
  if (v === "iso-2022-jp") return "iso-2022-jp";
  if (v === "euc-jp") return "euc-jp";
  if (v === "utf8") return "utf-8";
  return v || "utf-8";
}

function partCharset(part: any) {
  const contentType = part.headers?.find((h: any) => h.name?.toLowerCase() === "content-type")?.value || "";
  const match = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match?.[1] || "utf-8";
}

function headerValue(part: any, name: string) {
  return part.headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeQuotedPrintable(s: string) {
  return s
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/=\r?\n/g, "");
}

function decodeMimeHeader(value: string) {
  return value.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toLowerCase() === "b"
        ? Buffer.from(data, "base64")
        : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "binary");
      return iconv.decode(bytes, normalizeCharset(charset));
    } catch {
      return data;
    }
  });
}

export async function listNikkeiMessages(accessToken: string) {
  const gmail = await gmailClient(accessToken);
  const r = await gmail.users.messages.list({
    userId: "me",
    q: "{from:nikkei-news@mx.nikkei.com from:sokuho-news@mx.nikkei.com}",
    maxResults: 30,
  });
  return r.data.messages ?? [];
}

export async function getMessage(accessToken: string, id: string) {
  const gmail = await gmailClient(accessToken);
  const r = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  return r.data;
}

export async function extractMimeBody(accessToken: string, messageId: string, payload: any): Promise<{ html: string; text: string }> {
  const gmail = await gmailClient(accessToken);
  let html = "";
  let text = "";
  const cidMap = new Map<string, string>();

  const walk = async (p: any): Promise<void> => {
    if (!p) return;
    const mime = p.mimeType || "";
    const contentId = headerValue(p, "Content-ID").replace(/^<|>$/g, "").trim();

    if (mime.startsWith("image/") && p.body?.attachmentId && contentId) {
      const imageUrl =
        "/api/email-image?messageId=" + encodeURIComponent(messageId) +
        "&attachmentId=" + encodeURIComponent(p.body.attachmentId) +
        "&mimeType=" + encodeURIComponent(mime);
      cidMap.set(contentId, imageUrl);
    }

    if (p.body?.data) {
      const v = decodeBase64Url(p.body.data, partCharset(p));
      if (mime === "text/html" && !html) html = v;
      if (mime === "text/plain" && !text) text = v;
    }

    for (const x of p.parts || []) await walk(x);
  };

  await walk(payload);

  if (html && cidMap.size) {
    for (const [cid, url] of cidMap) {
      const escaped = cid.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp("cid:" + escaped, "gi"), url);
    }
  }

  return { html, text };
}

export function header(message: any, name: string) {
  const value = message.payload?.headers?.find(
    (h: any) => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || "";
  return decodeMimeHeader(value);
}
