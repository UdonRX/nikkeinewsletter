import iconv from "iconv-lite";
import { gmailClient } from "./google";

function decodeBase64Url(s: string, charset = "utf-8") {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(normalized, "base64");
  try { return iconv.decode(bytes, normalizeCharset(charset)); }
  catch { return iconv.decode(bytes, "utf-8"); }
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
  return s.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/=\r?\n/g, "");
}
function decodeMimeHeader(value: string) {
  return value.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toLowerCase() === "b" ? Buffer.from(data, "base64") : Buffer.from(decodeQuotedPrintable(data.replace(/_/g, " ")), "binary");
      return iconv.decode(bytes, normalizeCharset(charset));
    } catch { return data; }
  });
}

const QUERY = "{from:nikkei-news@mx.nikkei.com from:sokuho-news@mx.nikkei.com}";
const MAX_CACHED_MESSAGES = 30;

export async function listNikkeiMessages(accessToken: string) {
  const started = Date.now();
  const gmail = await gmailClient(accessToken);
  const r = await gmail.users.messages.list({ userId: "me", q: QUERY, maxResults: MAX_CACHED_MESSAGES });
  const messages = r.data.messages ?? [];
  console.log("[GMAIL] API_LIST", { durationMs: Date.now() - started, messageCount: messages.length, maxResults: MAX_CACHED_MESSAGES });
  return messages;
}

export async function getProfileHistoryId(accessToken: string) {
  const started = Date.now();
  const gmail = await gmailClient(accessToken);
  const r = await gmail.users.getProfile({ userId: "me", fields: "historyId" });
  console.log("[GMAIL] API_PROFILE", { durationMs: Date.now() - started });
  return r.data.historyId || "";
}

function parseBatchResponse(body: string, contentType: string, ids: string[]) {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  if (!match) throw new Error("Gmail batch response boundary missing");
  const boundary = match[1];
  const parts = body.split("--" + boundary).filter(p => /HTTP\/1\.1/.test(p));
  const byId = new Map<string, any>();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const jsonStart = part.indexOf("{");
    if (jsonStart < 0) continue;
    const jsonEnd = part.lastIndexOf("}");
    if (jsonEnd < jsonStart) continue;
    try {
      const value = JSON.parse(part.slice(jsonStart, jsonEnd + 1));
      if (value.id) byId.set(value.id, value);
      else if (ids[i]) byId.set(ids[i], value);
    } catch {}
  }
  return ids.map(id => byId.get(id)).filter(Boolean);
}

export async function batchGetMessages(accessToken: string, ids: string[]) {
  if (!ids.length) return [];
  const started = Date.now();
  const all: any[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const boundary = "gmail_batch_" + crypto.randomUUID().replace(/-/g, "");
    const fields = encodeURIComponent("id,threadId,internalDate,snippet,payload,historyId");
    const parts = chunk.map((id, i) =>
      "--" + boundary + "\r\n" +
      "Content-Type: application/http\r\n" +
      "Content-ID: <item-" + i + ">\r\n\r\n" +
      "GET /gmail/v1/users/me/messages/" + encodeURIComponent(id) + "?format=full&fields=" + fields + "\r\n\r\n"
    ).join("") + "--" + boundary + "--\r\n";
    const response = await fetch("https://www.googleapis.com/batch/gmail/v1", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "multipart/mixed; boundary=" + boundary,
      },
      body: parts,
      cache: "no-store",
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error("Gmail batch request failed: " + response.status);
    const values = parseBatchResponse(responseBody, response.headers.get("content-type") || "", chunk);
    all.push(...values);
  }
  console.log("[GMAIL] API_BATCH_GET", { durationMs: Date.now() - started, requested: ids.length, received: all.length });
  return all;
}

export async function getHistoryChanges(accessToken: string, startHistoryId: string) {
  const started = Date.now();
  const gmail = await gmailClient(accessToken);
  const added = new Set<string>();
  const deleted = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  do {
    const r = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded", "messageDeleted"],
      maxResults: 100,
      pageToken,
      fields: "historyId,nextPageToken,history(messagesAdded(message(id,threadId)),messagesDeleted(message(id,threadId)))",
    });
    latestHistoryId = r.data.historyId || latestHistoryId;
    for (const h of r.data.history || []) {
      for (const x of h.messagesAdded || []) if (x.message?.id) added.add(x.message.id);
      for (const x of h.messagesDeleted || []) if (x.message?.id) deleted.add(x.message.id);
    }
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  console.log("[GMAIL] API_HISTORY", { durationMs: Date.now() - started, added: added.size, deleted: deleted.size, historyId: latestHistoryId });
  return { addedIds: [...added], deletedIds: [...deleted], historyId: latestHistoryId };
}

export async function extractMimeBody(messageId: string, payload: any): Promise<{ html: string; text: string }> {
  let html = "";
  let text = "";
  const cidMap = new Map<string, string>();
  const walk = async (p: any): Promise<void> => {
    if (!p) return;
    const mime = p.mimeType || "";
    const contentId = headerValue(p, "Content-ID").replace(/^<|>$/g, "").trim();
    if (mime.startsWith("image/") && p.body?.attachmentId && contentId) {
      const imageUrl = "/api/email-image?messageId=" + encodeURIComponent(messageId) + "&attachmentId=" + encodeURIComponent(p.body.attachmentId) + "&mimeType=" + encodeURIComponent(mime);
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
  if (html && cidMap.size) for (const [cid, url] of cidMap) {
    const escaped = cid.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp("cid:" + escaped, "gi"), url);
  }
  return { html, text };
}

export function header(message: any, name: string) {
  const value = message.payload?.headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
  return decodeMimeHeader(value);
}
