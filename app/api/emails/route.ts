import { NextResponse } from "next/server";
import { fetchNewsArticles, daypart, issueDate, toLegacyNews, TBS_RSS_STATUS } from "@/lib/rss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const articles = await fetchNewsArticles();
    const groups = new Map<string, typeof articles>();

    for (const article of articles) {
      const key = issueDate(article.publishedAt) + "|" + daypart(article.publishedAt);
      const list = groups.get(key) || [];
      list.push(article);
      groups.set(key, list);
    }

    const emails = [...groups.entries()]
      .map(([key, list]) => {
        const [date, kind] = key.split("|") as [string, "朝刊"|"昼刊"|"夕刊"];
        const sorted = list
          .sort((a,b)=>(b.importanceScore||0)-(a.importanceScore||0)||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime())
          .slice(0, 80);
        const internalDate = sorted[0]?.publishedAt || new Date().toISOString();
        const sources = [...new Set(sorted.map(a=>a.source))];
        return {
          id: `rss:${key}`, threadId: `rss:${key}`, from: sources.join(" / "),
          subject: `ニュース ${date} ${kind}`, receivedAt: internalDate,
          internalDate: String(new Date(internalDate).getTime()), issueDate: date, kind,
          snippet: sorted.slice(0,3).map(a=>a.title).join(" / "),
          newsCount: sorted.length, news: sorted.map(toLegacyNews),
        };
      })
      .sort((a,b)=>Number(b.internalDate)-Number(a.internalDate));

    return NextResponse.json({
      emails,
      sources: { enabled: ["AFPBB","マイナビニュース","ITmedia"], unavailable: [TBS_RSS_STATUS] },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[api/emails:rss]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "rss_error" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
