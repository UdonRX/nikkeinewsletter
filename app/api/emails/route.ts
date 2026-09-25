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
      const kind = sender.includes("sokuho-news@mx.nikkei.com") ? "速報" : "定期便";
      const { html, text } = await extractMimeBody(accessToken, m.id!, full.payload);
      const news = parseNikkeiEmail(html, text);

      emails.push({
        id: m.id,
        threadId: m.threadId,
        from,
        kind,
        subject: header(full, "Subject"),
        receivedAt: header(full, "Date"),
        internalDate: full.internalDate || "",
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
