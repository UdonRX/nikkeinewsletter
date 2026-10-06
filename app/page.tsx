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
  // STEP 1: a star has independent reach, momentum, and lifecycle state.
  trendReach: number;
  trendMomentum: number;
  bornAt: string;
  peakAt: string | null;
  lastSeenAt: string;
  decayRate: number;
  lifecycle: "birth" | "growth" | "peak" | "decay" | "dormant";
  peakReach: number;
  peakMomentum: number;
  relatedArticles: Article[];
  relatedMediaCount: number;
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
const norm = (s: string) => (s || "").toLowerCase().replace(/[「」『』【】\s　]/g, "").replace(/[^ぁ-んァ-ヶ一-龠a-z0-9]/gi, "");
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

function layoutTrends(trends: Trend[]) {
  // The universe has a fixed usable rectangle. Trend state decides where
  // a star belongs inside it; no trend can push the whole field outward.
  const X_MIN = 0.16;
  const X_MAX = 0.84;
  const Y_MIN = 0.16;
  const Y_MAX = 0.84;

  const rankMap = <T extends Trend>(items: T[], score: (t: T) => number) => {
    const sorted = items.slice().sort((a, b) => {
      const diff = score(a) - score(b);
      return diff || a.id.localeCompare(b.id);
    });
    const map = new Map<string, number>();
    sorted.forEach((item, index) => {
      map.set(item.id, sorted.length <= 1 ? 0.5 : index / (sorted.length - 1));
    });
    return map;
  };

  const minMax = (values: number[]) => ({
    min: Math.min(...values),
    max: Math.max(...values),
  });

  const spreadRange = minMax(trends.map(t => t.spreadScore));
  const natureRange = minMax(trends.map(t => t.natureScore));
  const spreadRank = rankMap(trends, t => t.spreadScore);
  const natureRank = rankMap(trends, t => t.natureScore);

  const normalize = (value: number, min: number, max: number) =>
    max - min < 0.0001 ? 0.5 : clamp((value - min) / (max - min));

  const points = trends.map(t => {
    // Mostly preserve the actual score, with a small rank component so
    // identical scores do not collapse into one coordinate.
    const spreadPosition =
      normalize(t.spreadScore, spreadRange.min, spreadRange.max) * 0.78 +
      (spreadRank.get(t.id) ?? 0.5) * 0.22;
    const naturePosition =
      (1 - normalize(t.natureScore, natureRange.min, natureRange.max)) * 0.78 +
      (1 - (natureRank.get(t.id) ?? 0.5)) * 0.22;

    return {
      ...t,
      x: X_MIN + spreadPosition * (X_MAX - X_MIN),
      y: Y_MIN + naturePosition * (Y_MAX - Y_MIN),
    };
  });

  // Only make a small local correction for collisions. The correction is
  // strictly clamped to the same rectangle, so spacing never changes the
  // overall universe scale.
  for (let iteration = 0; iteration < 10; iteration++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);

        if (distance < 0.0001) {
          let seed = 0;
          for (const ch of a.id + b.id) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
          const angle = (seed / 100000) * Math.PI * 2;
          dx = Math.cos(angle) * 0.001;
          dy = Math.sin(angle) * 0.001;
          distance = 0.001;
        }

        const minDistance = 0.026 + Math.min(0.010, (a.size + b.size) / 2800);
        if (distance >= minDistance) continue;

        const push = (minDistance - distance) * 0.34;
        const nx = dx / distance, ny = dy / distance;
        const wa = 0.8 + a.momentumScore * 0.2;
        const wb = 0.8 + b.momentumScore * 0.2;
        const total = wa + wb;

        a.x = clamp(a.x - nx * push * (wb / total), X_MIN, X_MAX);
        a.y = clamp(a.y - ny * push * (wb / total), Y_MIN, Y_MAX);
        b.x = clamp(b.x + nx * push * (wa / total), X_MIN, X_MAX);
        b.y = clamp(b.y + ny * push * (wa / total), Y_MIN, Y_MAX);
      }
    }
  }

  return points;
}

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

function natureScore(text: string, category = "other") {
  const event = (text.match(/発表|発表会|決定|成立|開始|発生|事故|地震|台風|会見|発売|合意|選挙|判決|逮捕|攻撃|災害|開幕|優勝|契約|就任|辞任|死亡|負傷|発見|公開|導入|買収|提携|決算|上場|値上がり|値下がり/g) || []).length;
  const reaction = (text.match(/炎上|批判|反応|話題|バズ|意見|賛否|トレンド|人気|拡散|SNS|コメント|議論|口コミ|感想|騒然|歓喜|困惑|絶賛|不満|物議/g) || []).length;

  // A bare trend term often contains no explicit event/reaction word.
  // Use the topic category as a weak prior only in that case, so the Y axis
  // still represents topic nature instead of collapsing every term to 0.5.
  const categoryPrior: Record<string, number> = {
    politics: 0.76,
    economy: 0.70,
    market: 0.68,
    international: 0.72,
    disaster: 0.84,
    science: 0.80,
    technology: 0.63,
    society: 0.61,
    sports: 0.55,
    entertainment: 0.43,
    life: 0.50,
    other: 0.50,
  };

  const prior = categoryPrior[category] ?? 0.5;
  const lexical = clamp(0.5 + (event - reaction) * 0.12);
  if (event === 0 && reaction === 0) return prior;

  // Lexical evidence is stronger than the category prior.
  return clamp(lexical * 0.78 + prior * 0.22);
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

  const previousSnapshots = readHistory();
  const previousByKeyword = new Map<string, Trend>();
  for (const snapshot of previousSnapshots) {
    for (const trend of snapshot.universe?.trends || []) {
      const key = norm(trend.keyword);
      if (key) previousByKeyword.set(key, trend);
    }
  }

  const raw = signals
    .map((s: any) => {
      const keyword = String(s.term || s.keyword || "").trim();
      if (!keyword) return null;

      const google = sourceRank(s, "google");
      const yahoo = sourceRank(s, "yahoo");
      const x = sourceRank(s, "x");
      const sourceCount = [google, yahoo, x].filter(Boolean).length;
      const ranks = [google, yahoo, x].filter(Boolean) as number[];
      const bestRank = ranks.length ? Math.min(...ranks) : 50;
      const relatedArticles = articleByTerm(keyword);

      // Trend Reach = how widely the topic has spread.
      const googleReach = google ? clamp((51 - Math.min(50, google)) / 50) : 0;
      const yahooReach = yahoo ? clamp((51 - Math.min(50, yahoo)) / 50) : 0;
      const xReach = x ? clamp((51 - Math.min(50, x)) / 50) : 0;
      const searchReach = Number.isFinite(Number(s.searchIncrease))
        ? clamp(Math.log10(Math.max(1, Number(s.searchIncrease))) / 6)
        : 0;
      const mediaNames = new Set(
        relatedArticles.map(a => String(a.source || "").trim()).filter(Boolean)
      );
      const articleReach = clamp(relatedArticles.length / 12);
      const mediaReach = clamp(mediaNames.size / 8);
      const crossSourceReach = clamp(sourceCount / 3);

      // Keep the dimensions independent: reach is not momentum.
      const spread = clamp(
        googleReach * 0.18 +
        yahooReach * 0.16 +
        xReach * 0.16 +
        searchReach * 0.16 +
        articleReach * 0.16 +
        mediaReach * 0.10 +
        crossSourceReach * 0.08
      );

      // Trend Momentum = how strongly the topic is moving now.
      const rankMomentum = ranks.length
        ? clamp((51 - Math.min(50, bestRank)) / 50)
        : 0;
      const sourceMomentum = crossSourceReach;
      const searchMomentum = searchReach;
      const coverageMomentum = clamp((relatedArticles.length + mediaNames.size) / 20);
      const previous = previousByKeyword.get(norm(keyword));
      const previousMomentum = previous?.trendMomentum ?? previous?.momentumScore;
      const previousReach = previous?.trendReach ?? previous?.spreadScore;
      const observed = s.observedAt || now;
      const observedMs = new Date(observed).getTime();
      const previousMs = previous ? new Date(previous.lastSeenAt).getTime() : NaN;
      const elapsedHours = Number.isFinite(previousMs)
        ? Math.max(0.25, (observedMs - previousMs) / 3600000)
        : 1;

      const rawMomentum = clamp(
        rankMomentum * 0.38 +
        searchMomentum * 0.27 +
        sourceMomentum * 0.18 +
        coverageMomentum * 0.17
      );
      const momentumDelta = previousMomentum == null ? 0 : rawMomentum - previousMomentum;
      const acceleration = clamp(0.5 + momentumDelta * 2.5);
      const momentum = clamp(rawMomentum * 0.72 + acceleration * 0.28);

      const trendReach = spread;
      const trendMomentum = momentum;
      const text = [keyword, ...signals
        .map((q: any) => String(q.term || q.keyword || ""))
        .filter((q: string) => q && q !== keyword && similarity(keyword, q) >= 0.28)
        .slice(0, 8), ...relatedArticles.map(a => a.title)].join(" ");
      const relatedWords = signals
        .map((q: any) => String(q.term || q.keyword || ""))
        .filter((q: string) => q && q !== keyword && similarity(keyword, q) >= 0.28)
        .slice(0, 8);
      const category = classifyCategory(text);
      const nature = natureScore(text, category);
      const y = 0.08 + Math.pow(1 - nature, 0.82) * 0.84;
      const xPos = 0.06 + Math.pow(trendReach, 0.82) * 0.88;

      // Size follows reach; brightness follows momentum.
      const size = 3.5 + trendReach * 15 + (sourceCount >= 3 ? 2.5 : 0);
      const brightness = 0.35 + trendMomentum * 0.65;
      const sourceNames = [
        google ? "Google" : "",
        yahoo ? "Yahoo" : "",
        x ? "X" : "",
      ].filter(Boolean);

      // Lifecycle is accumulated from the same stable keyword across snapshots.
      const previousPeakReach = previous?.peakReach ?? previousReach ?? 0;
      const previousPeakMomentum = previous?.peakMomentum ?? previousMomentum ?? 0;
      const isNew = !previous;
      const peakImproved =
        trendReach > previousPeakReach * 1.005 ||
        trendMomentum > previousPeakMomentum * 1.005;
      const peakReach = Math.max(previousPeakReach, trendReach);
      const peakMomentum = Math.max(previousPeakMomentum, trendMomentum);
      const peakAt = isNew
        ? null
        : peakImproved
          ? observed
          : previous?.peakAt || null;

      // Positive decayRate means momentum is falling. It is normalized to 0..1.
      const decayRate = previousMomentum == null
        ? 0
        : clamp((previousMomentum - trendMomentum) / elapsedHours);

      const lifecycle: Trend["lifecycle"] = isNew
        ? "birth"
        : trendMomentum >= Math.max(0.72, peakMomentum * 0.94)
          ? "peak"
          : decayRate >= 0.08
            ? "decay"
            : trendReach > (previousReach ?? 0) + 0.02 || trendMomentum > (previousMomentum ?? 0) + 0.02
              ? "growth"
              : "dormant";

      return {
        id: "trend:" + norm(keyword),
        keyword,
        relatedKeywords: relatedWords,
        sources: { google, yahoo, x },
        sourceNames,
        category,
        spreadScore: trendReach,
        momentumScore: trendMomentum,
        trendReach,
        trendMomentum,
        natureScore: nature,
        x: xPos,
        y,
        size,
        brightness,
        color: CATEGORY_COLORS[category] || CATEGORY_COLORS.other,
        bornAt: previous?.bornAt || observed,
        peakAt,
        lastSeenAt: observed,
        decayRate,
        lifecycle,
        peakReach,
        peakMomentum,
        relatedArticles,
        relatedMediaCount: mediaNames.size,
      } as Trend;
    })
    .filter(Boolean) as Trend[];

  const laidOut = layoutTrends(raw);



  const clusters: Cluster[] = [];
  const used = new Set<string>();
  for (const trend of laidOut) {
    if (used.has(trend.id)) continue;
    const members = laidOut.filter(other => {
      if (used.has(other.id)) return false;
      const distance = Math.hypot(trend.x - other.x, trend.y - other.y);
      const semantic = Math.max(similarity(trend.keyword, other.keyword), trend.relatedKeywords.some(k => similarity(k, other.keyword) > 0.35) ? 0.7 : 0);
      const categoryClose = trend.category === other.category ? 1 : 0;
      return distance < 0.25 && semantic >= 0.34 && categoryClose >= 0.5;
    });
    if (members.length < 2) continue;
    members.forEach(m => used.add(m.id));
    const x = clamp(0.04 + (members.reduce((n, m) => n + m.x, 0) / members.length - 0.04) * 1.04, 0.04, 0.96);
    const y = clamp(0.05 + (members.reduce((n, m) => n + m.y, 0) / members.length - 0.05) * 0.94, 0.05, 0.95);
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

  // Send the complete layout diagnostics to the server so they appear in Vercel logs.
  // This is intentionally separate from the normal timeline API summary log.
  const positionDiagnostics = laidOut.map(t => {
    const source = raw.find(r => r.id === t.id);
    const nearest = laidOut
      .filter(other => other.id !== t.id)
      .map(other => ({ id: other.id, keyword: other.keyword, distance: Math.hypot(t.x - other.x, t.y - other.y) }))
      .sort((a, b) => a.distance - b.distance)[0] || null;
    return {
      id: t.id,
      keyword: t.keyword,
      spreadScore: Number(t.spreadScore.toFixed(4)),
      momentumScore: Number(t.momentumScore.toFixed(4)),
      natureScore: Number(t.natureScore.toFixed(4)),
      rawX: Number((source?.x ?? t.x).toFixed(4)),
      rawY: Number((source?.y ?? t.y).toFixed(4)),
      finalX: Number(t.x.toFixed(4)),
      finalY: Number(t.y.toFixed(4)),
      renderLeftPercent: Number((t.x * 100).toFixed(2)),
      renderTopPercent: Number((t.y * 100).toFixed(2)),
      size: Number(t.size.toFixed(2)),
      nearestKeyword: nearest?.keyword || null,
      nearestDistance: nearest ? Number(nearest.distance.toFixed(4)) : null,
    };
  });

  const xValues = laidOut.map(t => t.x);
  const yValues = laidOut.map(t => t.y);
  const duplicateXY = new Map<string, number>();
  laidOut.forEach(t => {
    const key = `${t.x.toFixed(3)},${t.y.toFixed(3)}`;
    duplicateXY.set(key, (duplicateXY.get(key) || 0) + 1);
  });

  void fetch("/api/emails", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "trend_position_diagnostics",
      payload: {
        version: "fixed-field-v1",
        bounds: { xMin: 0.16, xMax: 0.84, yMin: 0.16, yMax: 0.84 },
        count: laidOut.length,
        xRange: xValues.length ? [Number(Math.min(...xValues).toFixed(4)), Number(Math.max(...xValues).toFixed(4))] : [],
        yRange: yValues.length ? [Number(Math.min(...yValues).toFixed(4)), Number(Math.max(...yValues).toFixed(4))] : [],
        duplicateCoordinateGroups: [...duplicateXY.entries()]
          .filter(([, count]) => count > 1)
          .map(([coordinate, count]) => ({ coordinate, count })),
        clusters: clusters.map(c => ({
          id: c.id,
          representativeKeyword: c.representativeKeyword,
          x: Number(c.x.toFixed(4)),
          y: Number(c.y.toFixed(4)),
          trendCount: c.trendIds.length,
          trendIds: c.trendIds,
        })),
        stars: positionDiagnostics,
      },
    }),
  }).catch(() => {});


  const dust = laidOut
    .filter(t => t.spreadScore < 0.42)
    .slice(0, 28)
    .map((t, i) => ({
      id: "dust:" + t.id,
      x: clamp(t.x + Math.sin(i * 3.7) * 0.04),
      y: clamp(t.y + Math.cos(i * 2.4) * 0.05),
      size: 0.9 + (i % 3) * 0.35,
      opacity: 0.2 + t.momentumScore * 0.25,
    }));

  return { timestamp: now, trends: laidOut, clusters, dust };
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
      trendReach: t.trendReach + (other.trendReach - t.trendReach) * at,
      trendMomentum: t.trendMomentum + (other.trendMomentum - t.trendMomentum) * at,
      decayRate: t.decayRate + (other.decayRate - t.decayRate) * at,
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
      const refreshToken = Date.now().toString();
      const r = await fetch(`/api/emails?_refresh=${refreshToken}`, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache, no-store, max-age=0",
          pragma: "no-cache",
          "x-news-debug-id": crypto.randomUUID(),
        },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "universe_error");
      const trendPayload = Array.isArray(d?.trends) ? d.trends.length : 0;
      console.info("[TREND_UNIVERSE] fetch_complete", { debugId: d?.debug?.debugId || "unknown", trends: trendPayload, timeline: Array.isArray(d?.timeline) ? d.timeline.length : 0 });
      const next = buildUniverse(d);
      console.info("[TREND_UNIVERSE] build_complete", { trends: next.trends.length, clusters: next.clusters.length, dust: next.dust.length, timestamp: next.timestamp });
      saveUniverse(next);
      const nextHistory = readHistory();
      setUniverse(next);
      setHistory(nextHistory);
      setHistoryIndex(-1);
      setLive(true);
      console.info("[TREND_UNIVERSE] history", { snapshots: nextHistory.length, sliderEnabled: nextHistory.length > 1 });
    } catch (e) {
      console.warn("[TREND_UNIVERSE] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // iOS Safari/PWA can keep a previous JS/API response alive longer than expected.
    // Always fetch a fresh universe when the app becomes visible/opened.
    const old = readHistory();
    setHistory(old);
    setLoading(true);
    void refresh();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setLoading(true);
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timer = window.setInterval(refresh, 30 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
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
  useEffect(() => {
    if (!visibleUniverse) return;
    console.info("[TREND_UNIVERSE] render_ready", { trends: visibleUniverse.trends.length, clusters: visibleUniverse.clusters.length, history: history.length, historyIndex });
  }, [visibleUniverse, history.length, historyIndex]);
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
    if (history.length < 2) {
      console.info("[TREND_UNIVERSE] slider_ignored", { reason: "insufficient_history", snapshots: history.length });
      return;
    }
    const idx = Math.round(value * (history.length - 1));
    setHistoryIndex(idx);
    setLive(idx === history.length - 1);
    console.info("[TREND_UNIVERSE] slider_change", { value: Number(value.toFixed(3)), index: idx, snapshots: history.length, timestamp: history[idx]?.timestamp || null });
  };

  const currentSlider = historyIndex < 0 ? 1 : history.length <= 1 ? 1 : historyIndex / (history.length - 1);

  return (
    <main className="universe-app">
      <style>{`
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
        .search input { min-width:0; width:100%; border:0; outline:0; background:transparent; color:#e9eff7; font-size:16px; }
        .search input::placeholder { color:#748195; }
        .space { position:absolute; inset:0; touch-action:none; user-select:none; }
        .space-inner { position:absolute; inset:0; transform:translate3d(${pan.x}%,${pan.y}%,0) scale(${zoom}); transform-origin:50% 50%; transition:transform .65s cubic-bezier(.2,.8,.2,1); }
        .dust { position:absolute; border-radius:50%; background:#c4d1e1; box-shadow:0 0 8px rgba(180,205,235,.22); }
        .axis-label { position:absolute; z-index:4; color:rgba(152,167,188,.22); font-size:7px; letter-spacing:.18em; pointer-events:none; white-space:nowrap; text-shadow:0 1px 8px rgba(0,0,0,.7); }
        .axis-top { top:calc(46px + env(safe-area-inset-top)); left:50%; transform:translateX(-50%); }
        .axis-bottom { bottom:calc(88px + env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); }
        .axis-left { left:7px; top:50%; transform:translateY(-50%); writing-mode:vertical-rl; }
        .axis-right { right:7px; top:50%; transform:translateY(-50%) rotate(180deg); writing-mode:vertical-rl; }
        .star { position:absolute; transform:translate(-50%,-50%); border:0; background:transparent; padding:0; cursor:pointer; color:white; }
        .star-core { position:relative; display:block; width:var(--s); height:var(--s); border-radius:50%; background:radial-gradient(circle, #fff 0%, var(--c) 32%, color-mix(in srgb,var(--c) 55%,transparent) 60%, transparent 72%); box-shadow:0 0 calc(var(--s)*1.2) color-mix(in srgb,var(--c) 48%,transparent); opacity:var(--b); transition:width .7s,height .7s,opacity .7s,box-shadow .7s,transform .7s; }
        .star:hover .star-core, .star:active .star-core { transform:scale(1.18); }
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
        .timeline { position:absolute; z-index:35; left:12px; right:12px; bottom:calc(30px + env(safe-area-inset-bottom)); height:50px; padding:7px 9px 5px; border:1px solid rgba(185,201,222,.12); border-radius:16px; background:rgba(5,10,17,.7); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }
        .timeline-row { display:flex; justify-content:space-between; color:#6f7e92; font-size:7px; letter-spacing:.08em; }
        .timeline input { width:100%; margin:5px 0 2px; accent-color:#c8d7e9; touch-action:none; }
        .live-button { position:absolute; z-index:36; right:20px; bottom:calc(70px + env(safe-area-inset-bottom)); border:1px solid rgba(190,208,230,.18); border-radius:999px; padding:6px 9px; background:rgba(5,10,17,.7); color:#aebdce; font-size:8px; letter-spacing:.08em; backdrop-filter:blur(14px); }
        .status { position:absolute; z-index:30; left:15px; bottom:calc(72px + env(safe-area-inset-bottom)); color:rgba(143,158,178,.45); font-size:7px; pointer-events:none; }
        .empty { position:absolute; inset:0; display:grid; place-items:center; color:#718096; font-size:10px; letter-spacing:.08em; }
        .back { border:0; background:transparent; color:#8290a2; font-size:9px; padding:0; margin-bottom:10px; }
        .search-hit { position:absolute; z-index:38; top:calc(50px + env(safe-area-inset-top)); left:50%; transform:translateX(-50%); color:#aebdce; font-size:8px; background:rgba(5,10,17,.72); padding:5px 9px; border-radius:999px; pointer-events:none; }
        @media(min-width:800px){ .universe-header{left:28px;right:28px}.hud{left:auto;right:28px;bottom:95px;width:360px}.timeline{left:28px;right:28px}.live-button{right:36px}.status{left:31px}.search{width:240px} }
        @media(prefers-reduced-motion:reduce){ .space-inner,.star-core{transition:none!important} }
      `}</style>

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
          {visibleUniverse?.dust.map(d => (
            <span key={d.id} className="dust" style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, width: d.size, height: d.size, opacity: d.opacity }} />
          ))}

          {visibleUniverse?.clusters.map(c => (
            <button
              key={c.id}
              className="cluster"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, ["--cc" as any]: CATEGORY_COLORS[c.category] || CATEGORY_COLORS.other, ["--cs" as any]: `${Math.min(180, c.size)}px` }}
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
            return (
              <button
                key={t.id}
                className="star"
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  ["--s" as any]: `${Math.max(3, t.size * (active ? 1.3 : 1))}px`,
                  ["--b" as any]: t.brightness,
                  ["--c" as any]: t.color,
                }}
                onClick={e => { e.stopPropagation(); openTrend(t); }}
                aria-label={t.keyword}
              >
                <span className="star-core" />
              </button>
            );
          })}

          {!visibleUniverse?.trends.length && <div className="empty">{loading ? "·　·　✦　·　·" : "TREND DATA NOT AVAILABLE"}</div>}
        </div>
      </div>

      <span className="axis-label axis-top">EVENT / FACT</span>
      <span className="axis-label axis-bottom">REACTION / OPINION</span>
      <span className="axis-label axis-left">LOCAL / NICHE</span>
      <span className="axis-label axis-right">WIDESPREAD</span>

      {searchMatch && <div className="search-hit">FOUND · {searchMatch.keyword}</div>}

      <div className="status">
        {loading ? "OBSERVING…" : live ? `LIVE · ${visibleUniverse ? timeLabel(visibleUniverse.timestamp) : "--:--"}` : `PAST · ${visibleUniverse ? timeLabel(visibleUniverse.timestamp) : "--:--"}`}
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
                  <div className="source-cell"><span>GOOGLE</span><strong>{selectedTrend.sources.google ? `#${selectedTrend.sources.google}` : "—"}</strong></div>
                  <div className="source-cell"><span>YAHOO</span><strong>{selectedTrend.sources.yahoo ? `#${selectedTrend.sources.yahoo}` : "—"}</strong></div>
                  <div className="source-cell"><span>X</span><strong>{selectedTrend.sources.x ? `#${selectedTrend.sources.x}` : "—"}</strong></div>
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
        <input aria-label="トレンド時間スライダー" type="range" min="0" max="1" step="0.001" value={currentSlider} disabled={history.length < 2} onChange={e => setPast(Number(e.target.value))} />
      </div>
    </main>
  );
}
