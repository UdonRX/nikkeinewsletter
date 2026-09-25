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

function editionLabel(internalDate: string | undefined, dateHeader: string, content = "") {
  // 日経メール本文に入っている「○/○ 朝版・昼版・夕版」を最優先する。
  // 配信時刻だけで判定すると、遅配・再送・タイムゾーン差で刊がずれるため。
  const head = content.slice(0, 12000);
  const explicitEdition = head.match(/(?:\d{1,2}\s*[\/月-]\s*\d{1,2}(?:\s*日)?|\d{1,2}月\d{1,2}日)[^\n]{0,30}(朝刊|朝版|昼刊|昼版|夕刊|夕版)/);
  if (explicitEdition) {
    const label = explicitEdition[1];
    if (label.includes("朝")) return "朝刊";
    if (label.includes("昼")) return "昼刊";
    if (label.includes("夕")) return "夕刊";
  }

  const d = internalDate ? new Date(Number(internalDate)) : new Date(dateHeader);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);

  if (hour >= 5 && hour < 11) return "朝刊";
  if (hour >= 11 && hour < 17) return "昼刊";
  return "夕刊";
}

function issueDate(internalDate: string | undefined, dateHeader: string, content = "") {
  const explicit = content.match(/(?:^|[^0-9])(20\d{2}[年\/-])?(\d{1,2})[月\/-](\d{1,2})(?:日)?/);
  const d = internalDate ? new Date(Number(internalDate)) : new Date(dateHeader);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? d.getFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? d.getMonth() + 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? d.getDate());
  if (!explicit) return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const y = explicit[1] ? Number(explicit[1].replace(/[^0-9]/g,"")) : year;
  return `${y}-${String(Number(explicit[2])).padStart(2,"0")}-${String(Number(explicit[3])).padStart(2,"0")}`;
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
      const kind = sender.includes("sokuho-news@mx.nikkei.com")
        ? "速報"
        : editionLabel(full.internalDate ?? undefined, dateHeader, contentForEdition);
      const mailIssueDate = issueDate(full.internalDate ?? undefined, dateHeader, contentForEdition);
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
