"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type SourceKey = "google" | "yahoo" | "x";
type Trend = {
  id: string;
  keyword: string;
  relatedKeywords: string[];
  sources: Record<SourceKey, number | undefined>;
  sourceNames: string[];
  category: string;
  spreadScore: number;
  momentumScore: number;
  natureScore: number;
  x: number;
  y: number;
  size: number;
  brightness: number;
  color: string;
  firstSeenAt: string;
  lastSeenAt: string;
  relatedArticles: Article[];
};

type Article = {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  category?: string;
  publishedAt?: string;
  imageUrl?: string;
};

type Cluster = {
  id: string;
  representativeKeyword: string;
  trendIds: string[];
  x: number;
  y: number;
  size: number;
  category: string;
  relatedness: number;
};

type Universe = {
  timestamp: string;
  trends: Trend[];
  clusters: Cluster[];
  dust: { id: string; x: number; y: number; size: number; opacity: number }[];
};

type ViewMode = "universe" | "cluster" | "star-system" | "detail";
type Snapshot = { timestamp: string; universe: Universe };

const HISTORY_KEY = "trend-universe-history-v1";
const CACHE_KEY = "trend-universe-latest-v1";
const MAX_HISTORY = 48;

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const norm = (s: string) => (s || "").toLowerCase().replace(/[「」『』【】\\s　]/g, "").replace(/[^ぁ-んァ-ヶ一-龠a-z0-9]/gi, "");
const words = (s: string) => {
  const n = norm(s);
  if (n.length < 2) return new Set([n]);
  return new Set(Array.from({ length: n.length - 1 }, (_, i) => n.slice(i, i + 2)));
};
const similarity = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y || x.includes(y) || y.includes(x)) return 1;
  const ax = words(x), by = words(y);
  let hit = 0;
  ax.forEach(g => { if (by.has(g)) hit++; });
  return hit / Math.max(1, ax.size + by.size - hit);
};

const CATEGORY_COLORS: Record<string, string> = {
  politics: "#f18a91",
  economy: "#8fd1a4",
  market: "#9bd3aa",
  international: "#b49ae8",
  society: "#b49ae8",
  disaster: "#8ebfe5",
  science: "#8ebfe5",
  technology: "#86cce3",
  entertainment: "#e7a56f",
  sports: "#e7a56f",
  life: "#9ed6b0",
  other: "#d8dbe0",
};

const categoryName = (c: string) => ({
  politics: "政治",
  economy: "経済",
  market: "市場",
  international: "国際",
  society: "社会",
  disaster: "災害",
  science: "科学",
  technology: "テクノロジー",
  entertainment: "エンタメ",
  sports: "スポーツ",
  life: "生活",
  other: "複合",
} as Record<string, string>)[c] || "複合";

function sourceRank(v: any, key: SourceKey) {
  const n = Number(v?.[key === "google" ? "googleRank" : key === "yahoo" ? "yahooRank" : "xRank"]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function classifyCategory(text: string) {
  const t = text || "";
  if (/首相|総理|政府|国会|選挙|法案|政党|内閣|議員|大統領|外交|政権/.test(t)) return "politics";
  if (/日銀|金利|GDP|物価|賃金|景気|為替|円相場|企業|決算|株|市場|TOPIX|日経平均|買収|合併/.test(t)) return "economy";
  if (/海外|国際|米国|中国|韓国|ロシア|ウクライナ|中東|欧州|NATO/.test(t)) return "international";
  if (/地震|台風|大雨|洪水|津波|火山|猛暑|気象|避難|災害|警報/.test(t)) return "disaster";
  if (/AI|半導体|スマホ|iPhone|IT|クラウド|ソフト|ゲーム機|ロボット|宇宙|科学|研究/.test(t)) return /宇宙|科学|研究/.test(t) ? "science" : "technology";
  if (/野球|サッカー|バスケ|テニス|五輪|選手|試合|スポーツ/.test(t)) return "sports";
  if (/映画|ドラマ|音楽|芸能|俳優|アイドル|アニメ|漫画|ゲーム/.test(t)) return "entertainment";
  if (/生活|食品|住宅|旅行|医療|教育|子育て|暮らし/.test(t)) return "life";
  if (/事故|事件|逮捕|裁判|犯罪|社会|死亡|負傷/.test(t)) return "society";
  return "other";
}

function natureScore(text: string) {
  const event = (text.match(/発表|決定|成立|開始|発生|事故|地震|台風|会見|発売|合意|選挙|判決|逮捕|攻撃|災害|開幕|優勝/g) || []).length;
  const reaction = (text.match(/炎上|批判|反応|話題|バズ|意見|賛否|トレンド|人気|拡散|SNS|コメント|議論/g) || []).length;
  return clamp(0.5 + (event - reaction) * 0.12);
}

function buildUniverse(payload: any, now = new Date().toISOString()): Universe {
  const signals = Array.isArray(payload?.trends) ? payload.trends : [];
  const timeline = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const articleByTerm = (term: string): Article[] => {
    const related = timeline
      .filter((x: any) => {
        const hay = [x.title, x.summary, ...(x.keywords || [])].join(" ");
        return similarity(hay, term) >= 0.18 || (x.keywords || []).some((k: string) => similarity(k, term) >= 0.55);
      })
      .slice(0, 8);
    return related.map((x: any) => ({
      id: String(x.id),
      title: String(x.title || ""),
      summary: x.summary,
      url: x.sourceUrl,
      source: x.source,
      category: x.category,
      publishedAt: x.publishedAt || x.detectedAt,
      imageUrl: x.imageUrl,
    }));
  };

  const raw = signals
    .map((s: any, index: number) => {
      const keyword = String(s.term || s.keyword || "").trim();
      if (!keyword) return null;
      const google = sourceRank(s, "google");
      const yahoo = sourceRank(s, "yahoo");
      const x = sourceRank(s, "x");
      const sourceCount = [google, yahoo, x].filter(Boolean).length;
      const ranks = [google, yahoo, x].filter(Boolean) as number[];
      const bestRank = ranks.length ? Math.min(...ranks) : 50;
      const relatedArticles = articleByTerm(keyword);
      const relatedWords = signals
        .map((q: any) => String(q.term || q.keyword || ""))
        .filter((q: string) => q && q !== keyword && similarity(keyword, q) >= 0.28)
        .slice(0, 8);
      const spread = clamp(
        0.14 +
        sourceCount * 0.18 +
        Math.max(0, (50 - Math.min(50, bestRank)) / 50) * 0.45 +
        Math.min(0.18, relatedArticles.length * 0.025)
      );
      const momentum = clamp(
        0.2 +
        (bestRank <= 3 ? 0.55 : bestRank <= 10 ? 0.35 : 0.15) +
        (sourceCount >= 2 ? 0.15 : 0) +
        Math.min(0.2, relatedArticles.length * 0.025)
      );
      const text = [keyword, ...relatedWords, ...relatedArticles.map(a => a.title)].join(" ");
      const category = classifyCategory(text);
      const nature = natureScore(text);
      const y = 1 - nature;
      const xPos = spread;
      const size = 3.5 + spread * 15 + (sourceCount >= 3 ? 2.5 : 0);
      const brightness = 0.35 + momentum * 0.65;
      const sourceNames = [
        google ? "Google" : "",
        yahoo ? "Yahoo" : "",
        x ? "X" : "",
      ].filter(Boolean);
      const observed = s.observedAt || now;
      return {
        id: "trend:" + norm(keyword) + ":" + index,
        keyword,
        relatedKeywords: relatedWords,
        sources: { google, yahoo, x },
        sourceNames,
        category,
        spreadScore: spread,
        momentumScore: momentum,
        natureScore: nature,
        x: xPos,
        y,
        size,
        brightness,
        color: CATEGORY_COLORS[category] || CATEGORY_COLORS.other,
        firstSeenAt: observed,
        lastSeenAt: observed,
        relatedArticles,
      } as Trend;
    })
    .filter(Boolean) as Trend[];

  const clusters: Cluster[] = [];
  const used = new Set<string>();
  for (const trend of raw) {
    if (used.has(trend.id)) continue;
    const members = raw.filter(other => {
      if (used.has(other.id)) return false;
      const distance = Math.hypot(trend.x - other.x, trend.y - other.y);
      const semantic = Math.max(similarity(trend.keyword, other.keyword), trend.relatedKeywords.some(k => similarity(k, other.keyword) > 0.35) ? 0.7 : 0);
      const categoryClose = trend.category === other.category ? 1 : 0;
      return distance < 0.25 && semantic >= 0.34 && categoryClose >= 0.5;
    });
    if (members.length < 2) continue;
    members.forEach(m => used.add(m.id));
    const x = members.reduce((n, m) => n + m.x, 0) / members.length;
    const y = members.reduce((n, m) => n + m.y, 0) / members.length;
    const spread = members.reduce((n, m) => n + m.spreadScore, 0) / members.length;
    clusters.push({
      id: "cluster:" + norm(trend.keyword),
      representativeKeyword: members.slice().sort((a, b) => b.size - a.size)[0].keyword,
      trendIds: members.map(m => m.id),
      x,
      y,
      size: 28 + members.length * 9 + spread * 35,
      category: members[0].category,
      relatedness: Math.min(1, members.length / 8),
    });
  }

  const dust = raw
    .filter(t => t.spreadScore < 0.42)
    .slice(0, 28)
    .map((t, i) => ({
      id: "dust:" + t.id,
      x: clamp(t.x + Math.sin(i * 3.7) * 0.04),
      y: clamp(t.y + Math.cos(i * 2.4) * 0.05),
      size: 0.9 + (i % 3) * 0.35,
      opacity: 0.2 + t.momentumScore * 0.25,
    }));

  return { timestamp: now, trends: raw, clusters, dust };
}

function readHistory(): Snapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveUniverse(universe: Universe) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(universe));
    const history = readHistory();
    const next = [...history.filter(x => Math.abs(new Date(x.timestamp).getTime() - new Date(universe.timestamp).getTime()) > 90_000), { timestamp: universe.timestamp, universe }]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

function readCachedUniverse(): Universe | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return parsed?.trends && parsed?.clusters ? parsed : null;
  } catch { return null; }
}

function interpolate(a: Universe, b: Universe, at: number): Universe {
  const mapB = new Map(b.trends.map(t => [norm(t.keyword), t]));
  const trends = a.trends.map(t => {
    const other = mapB.get(norm(t.keyword));
    if (!other) return { ...t, size: t.size * (1 - at), brightness: t.brightness * (1 - at) };
    return {
      ...t,
      x: t.x + (other.x - t.x) * at,
      y: t.y + (other.y - t.y) * at,
      size: t.size + (other.size - t.size) * at,
      brightness: t.brightness + (other.brightness - t.brightness) * at,
      spreadScore: t.spreadScore + (other.spreadScore - t.spreadScore) * at,
      momentumScore: t.momentumScore + (other.momentumScore - t.momentumScore) * at,
    };
  });
  return { ...b, timestamp: new Date(new Date(a.timestamp).getTime() + (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) * at).toISOString(), trends };
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export default function Home() {
  const [universe, setUniverse] = useState<Universe | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("universe");
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [query, setQuery] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/emails", { cache: "no-store", headers: { "x-news-debug-id": crypto.randomUUID() } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "universe_error");
      const next = buildUniverse(d);
      saveUniverse(next);
      setUniverse(next);
      setHistory(readHistory());
      setHistoryIndex(-1);
      setLive(true);
    } catch (e) {
      console.warn("[TREND_UNIVERSE] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedUniverse();
    const old = readHistory();
    if (cached) { setUniverse(cached); setLoading(false); }
    setHistory(old);
    refresh();
  }, [refresh]);

  const visibleUniverse = useMemo(() => {
    if (!universe || historyIndex < 0 || history.length < 1) return universe;
    const target = history[historyIndex]?.universe;
    if (!target) return universe;
    const currentTime = new Date(universe.timestamp).getTime();
    const targetTime = new Date(target.timestamp).getTime();
    const before = history.filter(h => new Date(h.timestamp).getTime() <= targetTime).at(-1);
    const after = history.find(h => new Date(h.timestamp).getTime() >= targetTime);
    if (before && after && before.timestamp !== after.timestamp) {
      const span = new Date(after.timestamp).getTime() - new Date(before.timestamp).getTime();
      const t = clamp((targetTime - new Date(before.timestamp).getTime()) / Math.max(1, span));
      return interpolate(before.universe, after.universe, t);
    }
    void currentTime;
    return target;
  }, [universe, history, historyIndex]);

  const searchMatch = useMemo(() => {
    const q = norm(query);
    if (!q || !visibleUniverse) return null;
    return visibleUniverse.trends.find(t => norm(t.keyword).includes(q) || t.relatedKeywords.some(k => norm(k).includes(q))) || null;
  }, [query, visibleUniverse]);

  useEffect(() => {
    if (searchMatch) {
      setPan({ x: (0.5 - searchMatch.x) * 100, y: (0.5 - searchMatch.y) * 100 });
    }
  }, [searchMatch]);

  const displayedTrends = visibleUniverse?.trends || [];
  const selectedMembers = selectedCluster ? displayedTrends.filter(t => selectedCluster.trendIds.includes(t.id)) : [];
  const selectedSystem = selectedTrend
    ? displayedTrends.filter(t => t.id === selectedTrend.id || similarity(t.keyword, selectedTrend.keyword) > 0.28 || selectedTrend.relatedKeywords.includes(t.keyword)).slice(0, 9)
    : [];

  const openCluster = (cluster: Cluster) => {
    setSelectedCluster(cluster);
    setSelectedTrend(null);
    setViewMode("cluster");
  };

  const openTrend = (trend: Trend) => {
    setSelectedTrend(trend);
    setSelectedCluster(null);
    setViewMode("star-system");
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y;
    setPan({ x: dragRef.current.panX + dx / Math.max(1, e.currentTarget.clientWidth) * 100, y: dragRef.current.panY + dy / Math.max(1, e.currentTarget.clientHeight) * 100 });
  };
  const onPointerUp = () => { dragRef.current = null; };

  const setPast = (value: number) => {
    if (!history.length) return;
    const idx = Math.round(value * (history.length - 1));
    setHistoryIndex(idx);
    setLive(idx === history.length - 1);
  };

  const currentSlider = historyIndex < 0 ? 1 : history.length <= 1 ? 1 : historyIndex / (history.length - 1);

  return (
    <main className="universe-app">
      <style>{\`
        :root { color-scheme: dark; }
        html, body { margin:0; padding:0; background:#03060c; overflow:hidden; }
        body { min-height:100dvh; }
        .universe-app { position:fixed; inset:0; overflow:hidden; background:
          radial-gradient(ellipse at 52% 44%, rgba(31,49,76,.22), transparent 48%),
          radial-gradient(ellipse at 20% 70%, rgba(20,33,55,.16), transparent 44%),
          #03060c; color:#eef3fa; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;
          padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
        .universe-header { position:absolute; z-index:30; top:calc(12px + env(safe-area-inset-top)); left:14px; right:14px; display:flex; align-items:center; justify-content:space-between; pointer-events:none; }
        .brand { pointer-events:auto; letter-spacing:.16em; font-size:10px; font-weight:800; color:rgba(238,243,250,.82); }
        .brand small { display:block; margin-top:4px; color:rgba(157,170,188,.58); letter-spacing:.08em; font-size:7px; font-weight:600; }
        .search { pointer-events:auto; width:min(190px,42vw); height:31px; display:flex; align-items:center; gap:7px; padding:0 10px; border:1px solid rgba(185,201,222,.14); border-radius:999px; background:rgba(7,12,20,.52); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
        .search span { color:#94a5bc; font-size:13px; }
        .search input { min-width:0; width:100%; border:0; outline:0; background:transparent; color:#e9eff7; font-size:10px; }
        .search input::placeholder { color:#748195; }
        .space { position:absolute; inset:0; touch-action:none; user-select:none; }
        .space-inner { position:absolute; inset:0; transform:translate3d(\${pan.x}%,\${pan.y}%,0) scale(\${zoom}); transform-origin:50% 50%; transition:transform .65s cubic-bezier(.2,.8,.2,1); }
        .dust { position:absolute; border-radius:50%; background:#c4d1e1; box-shadow:0 0 8px rgba(180,205,235,.22); }
        .axis-label { position:absolute; z-index:2; color:rgba(152,167,188,.18); font-size:7px; letter-spacing:.18em; pointer-events:none; }
        .axis-top { top:17%; left:50%; transform:translateX(-50%); }
        .axis-bottom { bottom:19%; left:50%; transform:translateX(-50%); }
        .axis-left { left:6%; top:50%; transform:translateY(-50%) rotate(-90deg); }
        .axis-right { right:6%; top:50%; transform:translateY(-50%) rotate(90deg); }
        .star { position:absolute; transform:translate(-50%,-50%); border:0; background:transparent; padding:0; cursor:pointer; color:white; }
        .star-core { position:relative; display:block; width:var(--s); height:var(--s); border-radius:50%; background:radial-gradient(circle, #fff 0%, var(--c) 32%, color-mix(in srgb,var(--c) 55%,transparent) 60%, transparent 72%); box-shadow:0 0 calc(var(--s)*1.2) color-mix(in srgb,var(--c) 48%,transparent); opacity:var(--b); transition:width .7s,height .7s,opacity .7s,box-shadow .7s,transform .7s; }
        .star:hover .star-core, .star:active .star-core { transform:scale(1.18); }
        .star-label { display:block; margin-top:5px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:rgba(232,239,247,.78); font-size:8px; text-shadow:0 2px 8px #000; letter-spacing:-.01em; }
        .cluster { position:absolute; transform:translate(-50%,-50%); border:0; background:transparent; padding:0; color:white; cursor:pointer; }
        .cluster-cloud { position:absolute; left:50%; top:50%; width:var(--cs); height:var(--cs); transform:translate(-50%,-50%); border-radius:50%; background:radial-gradient(circle, color-mix(in srgb,var(--cc) 16%,transparent), transparent 68%); filter:blur(1px); pointer-events:none; }
        .cluster-name { position:relative; color:rgba(239,244,250,.55); font-size:8px; letter-spacing:.06em; text-shadow:0 2px 10px #000; }
        .cluster-dot { position:absolute; width:4px; height:4px; border-radius:50%; background:var(--cc); box-shadow:0 0 8px color-mix(in srgb,var(--cc) 65%,transparent); opacity:.85; transition:transform .6s ease; }
        .cluster-dot:nth-child(2){left:35%;top:40%}.cluster-dot:nth-child(3){left:58%;top:31%}.cluster-dot:nth-child(4){left:70%;top:54%}.cluster-dot:nth-child(5){left:42%;top:65%}.cluster-dot:nth-child(6){left:25%;top:55%}.cluster-dot:nth-child(7){left:54%;top:51%}
        .cluster:active .cluster-dot { transform:scale(1.6) translate(var(--dx,0),var(--dy,0)); }
        .hud { position:absolute; z-index:40; left:12px; right:12px; bottom:calc(78px + env(safe-area-inset-bottom)); pointer-events:none; display:flex; justify-content:center; }
        .panel { pointer-events:auto; width:min(430px,100%); max-height:56dvh; overflow:auto; border:1px solid rgba(185,201,222,.14); border-radius:20px; padding:15px; background:rgba(5,10,17,.76); backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px); box-shadow:0 20px 60px rgba(0,0,0,.4); }
        .panel-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
        .panel h2 { margin:0; font-size:18px; letter-spacing:-.035em; }
        .panel .eyebrow { margin-bottom:5px; color:#8190a4; font-size:7px; letter-spacing:.18em; }
        .close { border:0; background:transparent; color:#8d9bad; font-size:18px; padding:0 2px; }
        .source-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:13px; }
        .source-cell { border:1px solid rgba(185,201,222,.1); border-radius:10px; padding:7px 8px; background:rgba(255,255,255,.025); }
        .source-cell span { display:block; color:#68778b; font-size:7px; letter-spacing:.1em; }.source-cell strong { display:block; margin-top:4px; font-size:10px; }
        .panel-copy { color:#aab5c5; font-size:10px; line-height:1.65; margin:12px 0 0; }
        .related { display:flex; flex-direction:column; gap:5px; margin-top:12px; }
        .related button { border:1px solid rgba(185,201,222,.1); background:rgba(255,255,255,.025); color:#d8e0ea; border-radius:9px; text-align:left; padding:8px; font-size:9px; }
        .related small { display:block; color:#68778b; margin-top:3px; font-size:7px; }
        .panel-actions { display:flex; gap:6px; margin-top:12px; }
        .panel-actions button { flex:1; border:1px solid rgba(185,201,222,.12); background:rgba(255,255,255,.04); color:#bac5d3; border-radius:10px; padding:8px; font-size:9px; }
        .timeline { position:absolute; z-index:35; left:12px; right:12px; bottom:calc(10px + env(safe-area-inset-bottom)); height:50px; padding:7px 9px 5px; border:1px solid rgba(185,201,222,.12); border-radius:16px; background:rgba(5,10,17,.7); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
        .timeline-row { display:flex; justify-content:space-between; color:#6f7e92; font-size:7px; letter-spacing:.08em; }
        .timeline input { width:100%; margin:5px 0 2px; accent-color:#c8d7e9; }
        .live-button { position:absolute; z-index:36; right:20px; bottom:calc(70px + env(safe-area-inset-bottom)); border:1px solid rgba(190,208,230,.18); border-radius:999px; padding:6px 9px; background:rgba(5,10,17,.7); color:#aebdce; font-size:8px; letter-spacing:.08em; backdrop-filter:blur(14px); }
        .status { position:absolute; z-index:30; left:15px; bottom:calc(72px + env(safe-area-inset-bottom)); color:rgba(143,158,178,.45); font-size:7px; pointer-events:none; }
        .empty { position:absolute; inset:0; display:grid; place-items:center; color:#718096; font-size:10px; letter-spacing:.08em; }
        .back { border:0; background:transparent; color:#8290a2; font-size:9px; padding:0; margin-bottom:10px; }
        .search-hit { position:absolute; z-index:38; top:calc(50px + env(safe-area-inset-top)); left:50%; transform:translateX(-50%); color:#aebdce; font-size:8px; background:rgba(5,10,17,.72); padding:5px 9px; border-radius:999px; pointer-events:none; }
        @media(min-width:800px){ .universe-header{left:28px;right:28px}.hud{left:auto;right:28px;bottom:95px;width:360px}.timeline{left:28px;right:28px}.live-button{right:36px}.status{left:31px}.search{width:240px} }
        @media(prefers-reduced-motion:reduce){ .space-inner,.star-core{transition:none!important} }
      \`}</style>

      <header className="universe-header">
        <div className="brand">TREND UNIVERSE<small>OBSERVE WHAT IS HAPPENING NOW</small></div>
        <label className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="トレンドを探す" /></label>
      </header>

      <div
        className="space"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={e => setZoom(z => clamp(z - e.deltaY * 0.0007, .65, 2.4))}
      >
        <div className="space-inner">
          <span className="axis-label axis-top">EVENT / FACT</span>
          <span className="axis-label axis-bottom">REACTION / OPINION</span>
          <span className="axis-label axis-left">LOCAL / NICHE</span>
          <span className="axis-label axis-right">WIDESPREAD</span>

          {visibleUniverse?.dust.map(d => (
            <span key={d.id} className="dust" style={{ left: \`\${d.x * 100}%\`, top: \`\${d.y * 100}%\`, width: d.size, height: d.size, opacity: d.opacity }} />
          ))}

          {visibleUniverse?.clusters.map(c => (
            <button
              key={c.id}
              className="cluster"
              style={{ left: \`\${c.x * 100}%\`, top: \`\${c.y * 100}%\`, ["--cc" as any]: CATEGORY_COLORS[c.category] || CATEGORY_COLORS.other, ["--cs" as any]: \`\${Math.min(180, c.size)}px\` }}
              onClick={e => { e.stopPropagation(); openCluster(c); }}
            >
              <span className="cluster-cloud" />
              {[0,1,2,3,4,5].map(i => <span className="cluster-dot" key={i} />)}
              <span className="cluster-name">{c.representativeKeyword}</span>
            </button>
          ))}

          {displayedTrends.map(t => {
            const inCluster = visibleUniverse?.clusters.some(c => c.trendIds.includes(t.id));
            if (inCluster && viewMode === "universe") return null;
            const active = searchMatch?.id === t.id;
            const showLabel = t.size > 11 || active || viewMode !== "universe";
            return (
              <button
                key={t.id}
                className="star"
                style={{
                  left: \`\${t.x * 100}%\`,
                  top: \`\${t.y * 100}%\`,
                  ["--s" as any]: \`\${Math.max(3, t.size * (active ? 1.3 : 1))}px\`,
                  ["--b" as any]: t.brightness,
                  ["--c" as any]: t.color,
                }}
                onClick={e => { e.stopPropagation(); openTrend(t); }}
                aria-label={t.keyword}
              >
                <span className="star-core" />
                {showLabel && <span className="star-label">{t.keyword}</span>}
              </button>
            );
          })}

          {!visibleUniverse?.trends.length && <div className="empty">{loading ? "·　·　✦　·　·" : "TREND DATA NOT AVAILABLE"}</div>}
        </div>
      </div>

      {searchMatch && <div className="search-hit">FOUND · {searchMatch.keyword}</div>}

      <div className="status">
        {loading ? "OBSERVING…" : live ? \`LIVE · \${visibleUniverse ? timeLabel(visibleUniverse.timestamp) : "--:--"}\` : \`PAST · \${visibleUniverse ? timeLabel(visibleUniverse.timestamp) : "--:--"}\`}
      </div>

      {!live && <button className="live-button" onClick={() => { setHistoryIndex(-1); setLive(true); }}>NOW / LIVE</button>}

      {viewMode !== "universe" && (
        <div className="hud">
          <section className="panel">
            <button className="back" onClick={() => {
              if (viewMode === "detail") { setViewMode("star-system"); return; }
              if (viewMode === "star-system" && selectedCluster) { setViewMode("cluster"); return; }
              setSelectedCluster(null); setSelectedTrend(null); setViewMode("universe");
            }}>← 宇宙へ戻る</button>

            {viewMode === "cluster" && selectedCluster && (
              <>
                <div className="panel-head"><div><div className="eyebrow">STAR CLUSTER</div><h2>{selectedCluster.representativeKeyword}</h2></div><button className="close" onClick={() => {setViewMode("universe");setSelectedCluster(null)}}>×</button></div>
                <p className="panel-copy">同じ出来事・性質・関連度を持つトレンドが近接している星団。タップすると内部の個々の星を観測できる。</p>
                <div className="related">
                  {selectedMembers.map(t => <button key={t.id} onClick={() => openTrend(t)}>{t.keyword}<small>{categoryName(t.category)} · {t.sourceNames.join(" · ") || "source unknown"}</small></button>)}
                </div>
              </>
            )}

            {viewMode === "star-system" && selectedTrend && (
              <>
                <div className="panel-head"><div><div className="eyebrow">STAR SYSTEM</div><h2>{selectedTrend.keyword}</h2></div><button className="close" onClick={() => {setViewMode("universe");setSelectedTrend(null)}}>×</button></div>
                <p className="panel-copy">中心星に近いほど関連性が強いトレンド。ニュース一覧には切り替えず、宇宙空間のまま話題の構造を展開している。</p>
                <div className="source-grid">
                  <div className="source-cell"><span>GOOGLE</span><strong>{selectedTrend.sources.google ? \`#\${selectedTrend.sources.google}\` : "—"}</strong></div>
                  <div className="source-cell"><span>YAHOO</span><strong>{selectedTrend.sources.yahoo ? \`#\${selectedTrend.sources.yahoo}\` : "—"}</strong></div>
                  <div className="source-cell"><span>X</span><strong>{selectedTrend.sources.x ? \`#\${selectedTrend.sources.x}\` : "—"}</strong></div>
                </div>
                <div className="related">
                  {selectedSystem.map((t, i) => <button key={t.id} onClick={() => openTrend(t)}>{i === 0 ? "✦ " : "· "}{t.keyword}<small>{categoryName(t.category)} · spread {Math.round(t.spreadScore * 100)} · momentum {Math.round(t.momentumScore * 100)}</small></button>)}
                </div>
                <div className="panel-actions"><button onClick={() => setViewMode("detail")}>詳細を見る</button><button onClick={() => { if (selectedTrend.relatedArticles[0]?.url) window.open(selectedTrend.relatedArticles[0].url, "_blank", "noopener,noreferrer"); }}>関連ニュース</button></div>
              </>
            )}

            {viewMode === "detail" && selectedTrend && (
              <>
                <div className="panel-head"><div><div className="eyebrow">TREND SIGNAL</div><h2>{selectedTrend.keyword}</h2></div><button className="close" onClick={() => setViewMode("star-system")}>×</button></div>
                <div className="source-grid">
                  <div className="source-cell"><span>SPREAD</span><strong>{Math.round(selectedTrend.spreadScore * 100)}</strong></div>
                  <div className="source-cell"><span>MOMENTUM</span><strong>{Math.round(selectedTrend.momentumScore * 100)}</strong></div>
                  <div className="source-cell"><span>NATURE</span><strong>{selectedTrend.natureScore >= .5 ? "EVENT" : "REACTION"}</strong></div>
                </div>
                <p className="panel-copy">{categoryName(selectedTrend.category)} · {selectedTrend.sourceNames.join(" · ") || "トレンド信号"}</p>
                {selectedTrend.relatedKeywords.length > 0 && <div className="related">{selectedTrend.relatedKeywords.map(k => <button key={k}>{k}</button>)}</div>}
                {selectedTrend.relatedArticles.length > 0 && <div className="related">{selectedTrend.relatedArticles.slice(0,6).map(a => <button key={a.id} onClick={() => a.url && window.open(a.url, "_blank", "noopener,noreferrer")}>{a.title}<small>{a.source || "情報源"} · {a.publishedAt ? timeLabel(a.publishedAt) : "--:--"}</small></button>)}</div>}
              </>
            )}
          </section>
        </div>
      )}

      <div className="timeline">
        <div className="timeline-row"><span>24H</span><span>12H</span><span>6H</span><span>3H</span><span>1H</span><span>NOW</span></div>
        <input aria-label="トレンド時間スライダー" type="range" min="0" max="1" step="0.001" value={currentSlider} onChange={e => setPast(Number(e.target.value))} />
      </div>
    </main>
  );
}
