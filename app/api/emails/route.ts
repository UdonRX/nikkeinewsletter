import { NextRequest, NextResponse } from "next/server";
import { listNikkeiMessages, getMessage, extractMimeBody, header } from "@/lib/gmail";
import { parseNikkeiEmail } from "@/lib/parser";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";

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
  if (!accessToken) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  try {
    const ids = await listNikkeiMessages(accessToken);
    const emails = [];

    for (const m of ids.slice(0, 30)) {
      const full = await getMessage(accessToken, m.id!);
      const from = header(full, "From");
      const sender = from.toLowerCase();
      const kind = sender.includes("sokuho-news@mx.nikkei.com") ? "速報" : "定期便";
      const { html, text } = extractMimeBody(full.payload);
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

    emails.sort((a, b) => {
      const at = Number(a.internalDate || 0);
      const bt = Number(b.internalDate || 0);
      return bt - at;
    });

    return NextResponse.json({ emails });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "gmail_error" },
      { status: 502 }
    );
  }
}