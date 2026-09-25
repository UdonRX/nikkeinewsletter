import { NextRequest, NextResponse } from "next/server";
import { listNikkeiMessages, getMessage, extractMimeBody, header } from "@/lib/gmail";
import { parseNikkeiEmail } from "@/lib/parser";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function token(req: NextRequest) {
  const current = req.cookies.get("nn_access_token")?.value;
  if (current) return current;

  const refresh = await getRefreshToken();
  if (!refresh) return null;

  const fresh = await refreshAccessToken(refresh);
  if (fresh) await setAccessToken(fresh);
  return fresh;
}

function editionInfo(internalDate: string | undefined, dateHeader: string, content = "") {
  // HTMLでは「9/24」と「昼版」が別タグに分かれることがあるため、
  // 先頭部分をテキスト化してから「日付 + 刊情報」を1セットで読む。
  const plain = content
    .slice(0, 12000)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const explicit = plain.match(
    /(?:^|\s)(20\d{2}[年\/-])?(\d{1,2})\s*[\/-月]\s*(\d{1,2})\s*日?\s*(朝刊|朝版|昼刊|昼版|夕刊|夕版)(?=\s|$)/i,
  );

  const d = internalDate ? new Date(Number(internalDate)) : new Date(dateHeader);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? d.getFullYear());
  const fallbackMonth = Number(parts.find((part) => part.type === "month")?.value ?? d.getMonth() + 1);
  const fallbackDay = Number(parts.find((part) => part.type === "day")?.value ?? d.getDate());

  if (explicit) {
    const label = explicit[4];
    const kind = label.includes("朝") ? "朝刊" : label.includes("昼") ? "昼刊" : "夕刊";
    const y = explicit[1] ? Number(explicit[1].replace(/[^0-9]/g, "")) : year;
    const month = Number(explicit[2]);
    const day = Number(explicit[3]);
    return {
      kind,
      issueDate: `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    };
  }

  const hourParts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(hourParts.find((part) => part.type === "hour")?.value ?? 0);
  const kind = hour >= 5 && hour < 11 ? "朝刊" : hour >= 11 && hour < 17 ? "昼刊" : "夕刊";

  return {
    kind,
    issueDate: `${year}-${String(fallbackMonth).padStart(2, "0")}-${String(fallbackDay).padStart(2, "0")}`,
  };
}

function editionLabel(internalDate: string | undefined, dateHeader: string, content = "") {
  return editionInfo(internalDate, dateHeader, content).kind;
}

export async function GET(req: NextRequest) {
  const accessToken = await token(req);

  if (!accessToken) {
    return NextResponse.json(
      { error: "not_connected", message: "Googleアカウントを接続してください。" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const ids = await listNikkeiMessages(accessToken);
    const emails = [];

    for (const m of ids.slice(0, 30)) {
      const full = await getMessage(accessToken, m.id!);
      const from = header(full, "From");
      const sender = from.toLowerCase();
      const dateHeader = header(full, "Date") ?? "";
      const { html, text } = await extractMimeBody(accessToken, m.id!, full.payload);
      const contentForEdition = html || text || "";
      const edition = editionInfo(full.internalDate ?? undefined, dateHeader, contentForEdition);
      const kind = sender.includes("sokuho-news@mx.nikkei.com")
        ? "速報"
        : edition.kind;
      const mailIssueDate = edition.issueDate;
      const news = parseNikkeiEmail(html, text);

      emails.push({
        id: m.id,
        threadId: m.threadId,
        from,
        kind,
        subject: header(full, "Subject"),
        receivedAt: dateHeader,
        internalDate: full.internalDate || "",
        issueDate: mailIssueDate,
        snippet: full.snippet || "",
        newsCount: news.length,
        news,
      });
    }

    emails.sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

    return NextResponse.json({ emails }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[api/emails]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gmail_error" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
