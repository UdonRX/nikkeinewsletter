import iconv from "iconv-lite";
import { gmailClient } from "./google";

function decodeBase64Url(s: string, charset = "utf-8") {
  const bytes = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
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

function decodeQuotedPrintable(s: string) {
  return s.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
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

export function extractMimeBody(payload: any): { html: string; text: string } {
  let html = "";
  let text = "";
  const walk = (p: any) => {
    if (!p) return;
    const mime = p.mimeType || "";
    if (p.body?.data) {
      const v = decodeBase64Url(p.body.data, partCharset(p));
      if (mime === "text/html" && !html) html = v;
      if (mime === "text/plain" && !text) text = v;
    }
    for (const x of p.parts || []) walk(x);
  };
  walk(payload);
  return { html, text };
}

export function header(message: any, name: string) {
  const value = message.payload?.headers?.find(
    (h: any) => h.name?.toLowerCase() === name.toLowerCase()
  )?.value || "";
  return decodeMimeHeader(value);
}
