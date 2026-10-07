export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { get, list, put } from "@vercel/blob";
import { collectTimelineData } from "@/lib/trend-news";

const PREFIX = "trend-history/";
const RETENTION_DAYS = 30;
const MAX_HOURS = 720;

type StoredSnapshot = {
  version: 1;
  timestamp: string;
  payload: {
    trends: any[];
    timeline: any[];
  };
};

function dayKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function compactPayload(data: any, timestamp: string) {
  const trends = (Array.isArray(data?.signals) ? data.signals : []).map((t: any) => ({
    term: t.term,
    googleRank: t.googleRank,
    yahooRank: t.yahooRank,
    xRank: t.xRank,
    searchIncrease: t.searchIncrease,
    postCount: t.postCount,
    sources: Array.isArray(t.sources) ? t.sources.slice(0, 6) : [],
    observedAt: t.observedAt || timestamp,
    sourceUrl: t.sourceUrl,
  })).filter((t: any) => t.term);

  const timeline = (Array.isArray(data?.timeline) ? data.timeline : [])
    .slice()
    .sort((a: any, b: any) => (Number(b.importanceScore || 0) + Number(b.trendScore || 0)) - (Number(a.importanceScore || 0) + Number(a.trendScore || 0)))
    .slice(0, 220)
    .map((x: any) => ({
      id: x.id,
      type: x.type,
      title: x.title,
      summary: x.summary || x.description || "",
      description: x.description || x.summary || "",
      sourceUrl: x.sourceUrl,
      source: x.source,
      category: x.category,
      publishedAt: x.publishedAt,
      detectedAt: x.detectedAt,
      updatedAt: x.updatedAt,
      imageUrl: x.imageUrl,
      trendScore: x.trendScore,
      importanceScore: x.importanceScore,
      keywords: Array.isArray(x.keywords) ? x.keywords.slice(0, 10) : [],
    }));

  return { trends, timeline };
}

async function readDay(pathname: string): Promise<StoredSnapshot[]> {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result) return [];
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeDay(pathname: string, snapshots: StoredSnapshot[]) {
  await put(pathname, JSON.stringify(snapshots), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function POST(req: NextRequest) {
  const expected = process.env.TREND_CRON_SECRET;
  const provided = req.headers.get("x-trend-cron-secret") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const timestamp = new Date().toISOString();
  try {
    const data = await collectTimelineData([]);
    const payload = compactPayload(data, timestamp);
    const pathname = PREFIX + dayKey(timestamp) + ".json";
    const current = await readDay(pathname);
    const snapshot: StoredSnapshot = { version: 1, timestamp, payload };
    const next = [...current.filter(x => Math.abs(new Date(x.timestamp).getTime() - new Date(timestamp).getTime()) > 20 * 60 * 1000), snapshot]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-24);
    await writeDay(pathname, next);

    console.log("[TREND_HISTORY_HOURLY]", {
      timestamp,
      trends: payload.trends.length,
      timeline: payload.timeline.length,
      snapshotsToday: next.length,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: true, timestamp, trends: payload.trends.length, snapshotsToday: next.length });
  } catch (e) {
    console.error("[TREND_HISTORY_HOURLY] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "history_collect_failed" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const requested = Math.max(1, Math.min(MAX_HOURS, Number(req.nextUrl.searchParams.get("hours") || 168)));
    const { blobs } = await list({ prefix: PREFIX, limit: RETENTION_DAYS + 2 });
    const files = blobs
      .filter(b => b.pathname.endsWith(".json"))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, RETENTION_DAYS);

    const all: StoredSnapshot[] = [];
    for (const file of files) {
      all.push(...await readDay(file.pathname));
    }
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const snapshots = all.slice(-requested);

    return NextResponse.json(
      { ok: true, snapshots, count: snapshots.length, source: "vercel-blob" },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0", Pragma: "no-cache" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, snapshots: [], error: e instanceof Error ? e.message : "history_unavailable" }, { status: 200 });
  }
}
