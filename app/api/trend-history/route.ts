export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { del, get, put } from "@vercel/blob";
import { collectTimelineData } from "@/lib/trend-news";

const HISTORY_PATH = "trend-history/current.json";
const MAX_HOURS = 24;
const MISS_LIMIT = 3;


function normalizeTerm(value: string) {
  return String(value || "").toLowerCase().replace(/[「」『』【】\s　]/g, "").replace(/[^ぁ-んァ-ヶ一-龠a-z0-9]/gi, "");
}
function bigramSimilarity(a: string, b: string) {
  const x = normalizeTerm(a), y = normalizeTerm(b);
  if (!x || !y) return 0;
  if (x === y || x.includes(y) || y.includes(x)) return 1;
  const grams = (s: string) => new Set(Array.from({length: Math.max(1,s.length-1)}, (_,i)=>s.slice(i,i+2)));
  const ax=grams(x), by=grams(y); let hit=0;
  ax.forEach(g=>{if(by.has(g)) hit++;});
  return hit/Math.max(1,ax.size+by.size-hit);
}
function sourceCount(t: any) { return [t.googleRank,t.yahooRank,t.xRank].filter((v:any)=>Number.isFinite(Number(v)) && Number(v)>0).length; }
function signalReach(t: any) {
  const ranks=[t.googleRank,t.yahooRank,t.xRank].filter((v:any)=>Number.isFinite(Number(v)) && Number(v)>0).map(Number);
  const rank=ranks.length ? Math.min(...ranks) : 50;
  const rankReach=Math.max(0,Math.min(1,(51-Math.min(50,rank))/50));
  const search=Number.isFinite(Number(t.searchIncrease)) ? Math.max(0,Math.min(1,Math.log10(Math.max(1,Number(t.searchIncrease)))/6)) : 0;
  return Math.max(0,Math.min(1,rankReach*.52+search*.18+(sourceCount(t)/3)*.30));
}
function signalMomentum(t:any, previous:any) {
  const current=signalReach(t);
  const delta=previous ? current-Number(previous.reach||0) : 0;
  return Math.max(0,Math.min(1,current*.72+(Math.max(0,Math.min(1,.5+delta*2.5)))*.28));
}

type EntityState={entityId:string;canonicalKeyword:string;aliases:string[];firstSeenAt:string;lastSeenAt:string;peakAt:string|null;peakReach:number;peakMomentum:number;reach:number;momentum:number;consecutiveMisses:number;lifecycle:string};
function resolveEntity(term:string, previous:EntityState[]) {
  const n=normalizeTerm(term);
  let best:EntityState|null=null; let bestScore=0;
  for(const state of previous){
    const scores=[bigramSimilarity(term,state.canonicalKeyword),...state.aliases.slice(-8).map(a=>bigramSimilarity(term,a))];
    const score=Math.max(...scores);
    if(score>bestScore){bestScore=score;best=state;}
  }
  if(best && (bestScore>=0.82 || (bestScore>=0.70 && best.aliases.length>0))) return {state:best,score:bestScore};
  return {state:null,score:bestScore};
}
function buildServerLifecycle(payload:any, previousSnapshot:StoredSnapshot|undefined, timestamp:string) {
  const previousStates:EntityState[] = Array.isArray((previousSnapshot as any)?.entities) ? (previousSnapshot as any).entities : [];
  const used=new Set<string>();
  const entities:EntityState[]=[];
  const trends=(payload.trends||[]).map((t:any)=>{
    const resolved=resolveEntity(String(t.term||""),previousStates.filter(s=>!used.has(s.entityId)));
    const prev=resolved.state;
    const reach=signalReach(t); const momentum=signalMomentum(t,prev);
    const entityId=prev?.entityId || "entity:"+normalizeTerm(String(t.term||""));
    if(prev) used.add(prev.entityId);
    const peakReach=Math.max(prev?.peakReach||0,reach); const peakMomentum=Math.max(prev?.peakMomentum||0,momentum);
    const peakImproved=reach>=(prev?.peakReach||0)*1.01 || momentum>=(prev?.peakMomentum||0)*1.01;
    const lifecycle=!prev ? "birth" : momentum>=Math.max(.72,peakMomentum*.94) ? "peak" : (reach<Number(prev.reach||0)-.035 || momentum<Number(prev.momentum||0)-.05) ? "decay" : (reach>Number(prev.reach||0)+.02 || momentum>Number(prev.momentum||0)+.02) ? "growth" : "dormant";
    const state:EntityState={entityId,canonicalKeyword:prev?.canonicalKeyword||String(t.term||""),aliases:Array.from(new Set([...(prev?.aliases||[]),String(t.term||"")])).slice(-12),firstSeenAt:prev?.firstSeenAt||timestamp,lastSeenAt:timestamp,peakAt:peakImproved?timestamp:(prev?.peakAt||null),peakReach,peakMomentum,reach,momentum,consecutiveMisses:0,lifecycle};
    entities.push(state);
    return {...t,entityId,firstSeenAt:state.firstSeenAt,peakAt:state.peakAt,lastSeenAt:timestamp,peakReach,peakMomentum,lifecycle,identityScore:resolved.score};
  });
  for(const prev of previousStates){
    if(used.has(prev.entityId) || entities.some(e=>e.entityId===prev.entityId)) continue;
    const missed={...prev,consecutiveMisses:(prev.consecutiveMisses||0)+1,lastSeenAt:prev.lastSeenAt,lifecycle:(prev.consecutiveMisses||0)+1>=MISS_LIMIT?"disappeared":"decay"};
    if(missed.consecutiveMisses<MISS_LIMIT) entities.push(missed);
  }
  return {trends,entities};
}

type StoredSnapshot = {
  version: 1;
  timestamp: string;
  payload: {
    trends: any[];
    timeline: any[];
  };
  entities?: EntityState[];
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

async function readHistory(): Promise<StoredSnapshot[]> {
  try {
    const result = await get(HISTORY_PATH, { access: "private" });
    if (!result) return [];
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeHistory(snapshots: StoredSnapshot[]) {
  await put(HISTORY_PATH, JSON.stringify(snapshots), {
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
    const current = await readHistory();
    const previous = current.at(-1);
    const lifecycle = buildServerLifecycle(payload, previous, timestamp);
    const snapshot: StoredSnapshot = { version: 2, timestamp, payload: {...payload,trends:lifecycle.trends}, entities:lifecycle.entities };
    const next = [...current.filter(x => Math.abs(new Date(x.timestamp).getTime() - new Date(timestamp).getTime()) > 20 * 60 * 1000), snapshot]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-MAX_HOURS);
    await writeHistory(next);
    console.log("[TREND_HISTORY_LIFECYCLE]", {timestamp,entities:lifecycle.entities.length,birth:lifecycle.trends.filter((t:any)=>t.lifecycle==="birth").length,growth:lifecycle.trends.filter((t:any)=>t.lifecycle==="growth").length,peak:lifecycle.trends.filter((t:any)=>t.lifecycle==="peak").length,decay:lifecycle.trends.filter((t:any)=>t.lifecycle==="decay").length,identityMatches:lifecycle.trends.filter((t:any)=>Number(t.identityScore||0)>=.7).length,retainedHours:next.length});

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
    const requested = Math.max(1, Math.min(MAX_HOURS, Number(req.nextUrl.searchParams.get("hours") || MAX_HOURS)));
    const snapshots = (await readHistory()).slice(-requested);
    return NextResponse.json(
      { ok: true, snapshots, count: snapshots.length, source: "vercel-blob", retentionHours: MAX_HOURS },
      { headers: { "Cache-Control": "no-store, no-cache, max-age=0", Pragma: "no-cache" } }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, snapshots: [], error: e instanceof Error ? e.message : "history_unavailable" }, { status: 200 });
  }
}
