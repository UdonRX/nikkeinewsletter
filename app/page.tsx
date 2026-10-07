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
  interestBreadthScore: number;
  eventReactionScore: number;
  x: number;
  y: number;
  size: number;
  brightness: number;
  color: string;
  trendReach: number;
  trendMomentum: number;
  bornAt: string;
  peakAt: string | null;
  lastSeenAt: string;
  decayRate: number;
  lifecycle: "birth" | "growth" | "peak" | "decay" | "dormant" | "disappeared";
  entityId?: string;
  firstSeenAt?: string;
  identityScore?: number;
  peakReach: number;
  peakMomentum: number;
  relatedArticles: Article[];
  relatedMediaCount: number;
  semanticReason?: Record<string, any>;
};

type Article = {
  id: string;
  title: string;
  summary?: string;
  content?: string;
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
  clusterReach: number;
  clusterMomentum: number;
  relatedArticles: Article[];
  relatedMediaCount: number;
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
  // Semantic coordinate engine:
  // X = interest breadth (left: local/niche -> right: society-wide)
  // Y = event/reaction (top: happened -> bottom: people's reaction)
  // Collision avoidance is only a tiny final render correction and never
  // determines semantic placement or clustering.
  const X_MIN = 0.16;
  const X_MAX = 0.84;
  const Y_MIN = 0.16;
  const Y_MAX = 0.84;

  const points = trends.map(t => ({
    ...t,
    x: X_MIN + clamp(t.interestBreadthScore) * (X_MAX - X_MIN),
    y: Y_MAX - clamp(t.eventReactionScore) * (Y_MAX - Y_MIN),
  }));

  const semanticX = new Map(points.map(t => [t.id, t.x]));
  const semanticY = new Map(points.map(t => [t.id, t.y]));

  // Resolve only severe visual overlaps. Semantic coordinates remain dominant;
  // collision avoidance is a tiny render correction and cannot create layout.
  for (let iteration = 0; iteration < 4; iteration++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);

        if (distance < 0.0001) {
          let seed = 0;
          for (const ch of a.id + b.id) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
          const angle = (seed / 100000) * Math.PI * 2;
          dx = Math.cos(angle) * 0.001;
          dy = Math.sin(angle) * 0.001;
          distance = 0.001;
        }

        const minDistance = 0.018 + Math.min(0.004, (a.size + b.size) / 5000);
        if (distance >= minDistance) continue;

        const push = Math.min(0.0015, (minDistance - distance) * 0.12);
        const nx = dx / distance, ny = dy / distance;
        const wa = 0.8 + a.momentumScore * 0.2;
        const wb = 0.8 + b.momentumScore * 0.2;
        const total = wa + wb;

        const ax = clamp(a.x - nx * push * (wb / total), X_MIN, X_MAX);
        const ay = clamp(a.y - ny * push * (wb / total), Y_MIN, Y_MAX);
        const bx = clamp(b.x + nx * push * (wa / total), X_MIN, X_MAX);
        const by = clamp(b.y + ny * push * (wa / total), Y_MIN, Y_MAX);

        a.x = clamp(ax, semanticX.get(a.id)! - 0.006, semanticX.get(a.id)! + 0.006);
        a.y = clamp(ay, semanticY.get(a.id)! - 0.006, semanticY.get(a.id)! + 0.006);
        b.x = clamp(bx, semanticX.get(b.id)! - 0.006, semanticX.get(b.id)! + 0.006);
        b.y = clamp(by, semanticY.get(b.id)! - 0.006, semanticY.get(b.id)! + 0.006);
        a.x = clamp(a.x, X_MIN, X_MAX);
        a.y = clamp(a.y, Y_MIN, Y_MAX);
        b.x = clamp(b.x, X_MIN, X_MAX);
        b.y = clamp(b.y, Y_MIN, Y_MAX);
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

function semanticNatureScore(text: string, category = "other", articles: Article[] = []) {
  const eventTerms = [
    "発表","発表会","発足","決定","決定的","成立","開始","再開","発生","発生情報","事故","事件","地震","震度",
    "台風","大雨","洪水","津波","火山","噴火","警報","避難","会見","発売","合意","選挙","判決","逮捕","起訴",
    "攻撃","災害","開幕","優勝","敗退","契約","就任","辞任","死亡","死去","負傷","発見","公開","導入","買収",
    "提携","決算","上場","値上がり","値下がり","政府","首相","国会","法案","可決","承認","調査開始","調査結果",
    "サービス開始","新サービス","新製品","発売開始","決定しました","発表しました","明らかに","判明","確定",
    "発覚","確認","観測","発令","解除","到達","記録","更新","開催","延期","中止","移転","辞表","退任"
  ];
  const reactionTerms = [
    "炎上","批判","反応","話題","バズ","意見","賛否","トレンド","人気","拡散","SNS","コメント","議論","口コミ",
    "感想","騒然","歓喜","困惑","絶賛","不満","物議","大炎上","論争","ミーム","ネタ","推し","ランキング","急上昇",
    "共感","反響","声","話題に","注目集める","注目を集める","盛り上がり","ファン","ネット上","SNS上","ネットで",
    "おめでとう","お祝い","誕生祭","入所周年","推し活","お気持ち","賛成","反対","笑った","泣いた","好き","嫌い",
    "欲しい","ほしい","最高","最悪","かわいい","かっこいい","尊い","怖い","驚き","ショック","心配","ありがとう"
  ];

  const countWeighted = (value: string, terms: string[]) =>
    terms.reduce((sum, term) => {
      if (!term || !value) return sum;
      return sum + Math.min(4, Math.max(0, value.split(term).length - 1));
    }, 0);

  const scoreText = (value: string) => ({
    event: countWeighted(value, eventTerms),
    reaction: countWeighted(value, reactionTerms),
  });

  const keywordEvidence = scoreText(text);
  let eventEvidence = keywordEvidence.event;
  let reactionEvidence = keywordEvidence.reaction;
  let articleEventEvidence = 0;
  let articleReactionEvidence = 0;
  let articleEventHits = 0;
  let articleReactionHits = 0;

  for (const article of articles) {
    const title = String(article.title || "");
    const summary = String(article.summary || "");
    const content = String(article.content || "");
    const categoryText = String(article.category || "");
    const titleScore = scoreText(title);
    const summaryScore = scoreText(summary);
    const contentScore = scoreText(content);
    const categoryScore = scoreText(categoryText);

    articleEventEvidence += titleScore.event * 3.4 + contentScore.event * 2.0 + summaryScore.event * 1.5 + categoryScore.event * 0.25;
    articleReactionEvidence += titleScore.reaction * 3.2 + contentScore.reaction * 1.9 + summaryScore.reaction * 1.45 + categoryScore.reaction * 0.25;
    articleEventHits += titleScore.event + contentScore.event + summaryScore.event;
    articleReactionHits += titleScore.reaction + contentScore.reaction + summaryScore.reaction;
  }

  eventEvidence += articleEventEvidence;
  reactionEvidence += articleReactionEvidence;

  const eventPrior: Record<string, number> = {
    politics: 0.78,
    economy: 0.68,
    market: 0.66,
    international: 0.72,
    disaster: 0.91,
    science: 0.76,
    technology: 0.61,
    society: 0.64,
    sports: 0.55,
    entertainment: 0.40,
    life: 0.46,
    other: 0.44,
  };

  const prior = eventPrior[category] ?? 0.44;
  const totalEvidence = eventEvidence + reactionEvidence;
  const articleEvidence = articleEventEvidence + articleReactionEvidence;

  // Weakly evidenced topics must not all collapse to one fixed fallback.
  const factualShape = countWeighted(text, [
    "速報","情報","発表","決定","就任","地震","震度","警報","会見","発売","開始","開催","選挙","判決",
    "政府","首相","国会","法案","決算","事故","事件","死亡","負傷","調査","確認","記録","更新"
  ]);
  const socialShape = countWeighted(text, [
    "#","SNS","おめでとう","誕生祭","推し","ファン","反応","話題","炎上","感想","コメント","口コミ","ネタ",
    "ミーム","トレンド","人気","おはよう","みんな","ありがとう","最高","好き","かわいい","笑"
  ]);

  if (totalEvidence <= 0.01) {
    const articleContext = clamp(articles.length / 4);
    const shapeBalance = clamp(0.5 + (factualShape - socialShape) / Math.max(4, factualShape + socialShape + 4) * 0.34);
    const priorBlend = prior * (0.58 - articleContext * 0.10) + 0.5 * (0.42 + articleContext * 0.10);
    const score = clamp(priorBlend * 0.72 + shapeBalance * 0.28);
    return {
      score,
      confidence: clamp((articles.length * 0.08) + (factualShape + socialShape) * 0.035),
      eventEvidence,
      reactionEvidence,
      articleEventEvidence,
      articleReactionEvidence,
      articleEventHits,
      articleReactionHits,
      fallback: false,
      mode: "weak-context",
    };
  }

  const balance = (eventEvidence - reactionEvidence) / Math.max(1, totalEvidence);
  const confidence = clamp(totalEvidence / 24);
  const lexicalScore = 0.5 + balance * (0.45 + confidence * 0.08);
  const priorWeight = articleEvidence > 0 ? 0.045 : 0.16;
  const score = clamp(lexicalScore * (1 - priorWeight) + prior * priorWeight);

  return {
    score,
    confidence: clamp(confidence * 0.92 + Math.min(0.08, articles.length * 0.02)),
    eventEvidence,
    reactionEvidence,
    articleEventEvidence,
    articleReactionEvidence,
    articleEventHits,
    articleReactionHits,
    fallback: false,
    mode: articleEvidence > 0 ? "article-context" : "keyword-context",
  };
}
function buildSemanticCoordinates(args: {
  keyword: string;
  relatedKeywords: string[];
  relatedArticles: Article[];
  category: string;
  google?: number;
  yahoo?: number;
  x?: number;
  searchIncrease?: number;
}) {
  const {
    keyword,
    relatedKeywords,
    relatedArticles,
    category,
    google,
    yahoo,
    x,
    searchIncrease,
  } = args;

  const sourceRanks = [google, yahoo, x].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const sourceBreadth = sourceRanks.length / 3;
  const bestRank = sourceRanks.length ? Math.min(...sourceRanks) : 50;
  const rankBreadth = clamp((51 - Math.min(50, bestRank)) / 50);

  const mediaNames = new Set(
    relatedArticles.map(a => String(a.source || "").trim()).filter(Boolean)
  );
  const mediaBreadth = clamp(mediaNames.size / 6);
  const articleBreadth = clamp(relatedArticles.length / 8);
  const searchBreadth = Number.isFinite(Number(searchIncrease))
    ? clamp(Math.log10(Math.max(1, Number(searchIncrease))) / 6)
    : 0;
  const relatedBreadth = clamp(relatedKeywords.length / 6);

  // Interest breadth is deliberately not trendReach. It describes how far
  // interest spreads across audiences/sources/media, not how large the star is.
  const breadthInputs: Array<{ name: string; value: number; weight: number; observed: boolean }> = [
    { name: "sourceBreadth", value: sourceBreadth, weight: 0.27, observed: sourceRanks.length > 0 },
    { name: "rankBreadth", value: rankBreadth, weight: 0.19, observed: sourceRanks.length > 0 },
    { name: "mediaBreadth", value: mediaBreadth, weight: 0.23, observed: mediaNames.size > 0 },
    { name: "articleBreadth", value: articleBreadth, weight: 0.12, observed: relatedArticles.length > 0 },
    { name: "searchBreadth", value: searchBreadth, weight: 0.12, observed: Number.isFinite(Number(searchIncrease)) && Number(searchIncrease) > 0 },
    { name: "relatedBreadth", value: relatedBreadth, weight: 0.07, observed: relatedKeywords.length > 0 },
  ];
  const observedBreadthInputs = breadthInputs.filter(x => x.observed);
  const observedWeight = observedBreadthInputs.reduce((sum, x) => sum + x.weight, 0);
  const interestBreadthBase = observedWeight > 0
    ? observedBreadthInputs.reduce((sum, x) => sum + x.value * x.weight, 0) / observedWeight
    : 0.12;

  // Expand the sparse side non-linearly while reserving the far-right edge
  // for genuinely broad, multi-source topics.
  const interestBreadthScore = clamp(
    0.08 + 0.92 * Math.pow(clamp(interestBreadthBase), 0.68)
  );

  const semanticText = [
    keyword,
    ...relatedKeywords,
    ...relatedArticles.map(a => a.title),
    ...relatedArticles.map(a => a.summary || ""),
    ...relatedArticles.map(a => a.content || ""),
    ...relatedArticles.map(a => a.category || ""),
  ].join(" ");

  const semanticNature = semanticNatureScore(semanticText, category, relatedArticles);
  const eventReactionScore = semanticNature.score;

  return {
    interestBreadthScore,
    eventReactionScore,
    x: interestBreadthScore,
    y: eventReactionScore,
    reason: {
      sourceBreadth,
      rankBreadth,
      mediaBreadth,
      articleBreadth,
      searchBreadth,
      relatedBreadth,
      interestBreadthBase,
      interestBreadthScore,
      semanticConfidence: semanticNature.confidence,
      semanticMode: semanticNature.mode,
      eventEvidence: Number(semanticNature.eventEvidence.toFixed(3)),
      reactionEvidence: Number(semanticNature.reactionEvidence.toFixed(3)),
      articleEventEvidence: Number(semanticNature.articleEventEvidence.toFixed(3)),
      articleReactionEvidence: Number(semanticNature.articleReactionEvidence.toFixed(3)),
      articleEventHits: semanticNature.articleEventHits,
      articleReactionHits: semanticNature.articleReactionHits,
      fallbackUsed: semanticNature.fallback,
      xFormula: "0.08 + 0.92 * breadthBase^0.68",
      observedBreadthDimensions: observedBreadthInputs.map(x => x.name),
    },
  };
}

function sharedArticleScore(a: Trend, b: Trend) {
  const aIds = new Set(a.relatedArticles.map(article => article.id));
  const bIds = new Set(b.relatedArticles.map(article => article.id));
  if (!aIds.size || !bIds.size) return 0;
  let intersection = 0;
  aIds.forEach(id => { if (bIds.has(id)) intersection++; });
  return intersection / Math.max(1, aIds.size + bIds.size - intersection);
}

function sharedMediaScore(a: Trend, b: Trend) {
  const aNames = new Set(a.relatedArticles.map(article => String(article.source || "").trim()).filter(Boolean));
  const bNames = new Set(b.relatedArticles.map(article => String(article.source || "").trim()).filter(Boolean));
  if (!aNames.size || !bNames.size) return 0;
  let intersection = 0;
  aNames.forEach(name => { if (bNames.has(name)) intersection++; });
  return intersection / Math.max(1, aNames.size + bNames.size - intersection);
}

function semanticTrendSimilarity(a: Trend, b: Trend) {
  const keywordScore = similarity(a.keyword, b.keyword);
  const relatedKeywordScore = Math.max(
    0,
    ...a.relatedKeywords.map(k => similarity(k, b.keyword)),
    ...b.relatedKeywords.map(k => similarity(a.keyword, k)),
  );
  const articleScore = sharedArticleScore(a, b);
  const mediaScore = sharedMediaScore(a, b);
  const categoryScore = a.category === b.category ? 1 : 0;
  return clamp(
    keywordScore * 0.42 +
    relatedKeywordScore * 0.24 +
    articleScore * 0.20 +
    mediaScore * 0.06 +
    categoryScore * 0.08
  );
}

function semanticTrendFactors(a: Trend, b: Trend) {
  const keywordScore = similarity(a.keyword, b.keyword);
  const relatedKeywordScore = Math.max(
    0,
    ...a.relatedKeywords.map(k => similarity(k, b.keyword)),
    ...b.relatedKeywords.map(k => similarity(a.keyword, k)),
  );
  const articleScore = sharedArticleScore(a, b);
  const mediaScore = sharedMediaScore(a, b);
  const categoryScore = a.category === b.category ? 1 : 0;
  return {
    keywordScore,
    relatedKeywordScore,
    articleScore,
    mediaScore,
    categoryScore,
    total: clamp(
      keywordScore * 0.42 +
      relatedKeywordScore * 0.24 +
      articleScore * 0.20 +
      mediaScore * 0.06 +
      categoryScore * 0.08
    ),
  };
}

function clusterMemberPosition(cluster: Cluster, trend: Trend, index: number, total: number) {
  let seed = 0;
  for (const ch of trend.id + cluster.id) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const angle = (seed / 100000) * Math.PI * 2;
  const ring = total <= 1 ? 0 : Math.floor(index / 6);
  const ringCount = Math.min(6, Math.max(1, total));
  const slotAngle = angle + ((index % ringCount) / ringCount) * Math.PI * 2;
  const radius = 0.075 + ring * 0.052 + Math.min(0.018, trend.size / 1200);
  return {
    x: clamp(cluster.x + Math.cos(slotAngle) * radius, 0.08, 0.92),
    y: clamp(cluster.y + Math.sin(slotAngle) * radius, 0.10, 0.90),
  };
}

function buildUniverse(payload: any, now = new Date().toISOString(), historyOverride?: Snapshot[]): Universe {
  const signals = Array.isArray(payload?.trends) ? payload.trends : [];
  const timeline = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const articleByTerm = (term: string): Article[] => {
    const related = timeline
      .filter((x: any) => {
        const hay = [x.title, x.summary, x.content, x.body, x.description, ...(x.keywords || [])].join(" ");
        return similarity(hay, term) >= 0.18 || (x.keywords || []).some((k: string) => similarity(k, term) >= 0.55);
      })
      .slice(0, 8);
    return related.map((x: any) => ({
      id: String(x.id),
      title: String(x.title || ""),
      summary: x.summary || x.description,
      content: x.content || x.body || x.description,
      url: x.sourceUrl,
      source: x.source,
      category: x.category,
      publishedAt: x.publishedAt || x.detectedAt,
      imageUrl: x.imageUrl,
    }));
  };

  const previousSnapshots = historyOverride || readHistory();
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
      const coordinates = buildSemanticCoordinates({
        keyword,
        relatedKeywords: relatedWords,
        relatedArticles,
        category,
        google,
        yahoo,
        x,
        searchIncrease: Number(s.searchIncrease),
      });
      const nature = coordinates.eventReactionScore;
      const y = nature;
      const xPos = coordinates.interestBreadthScore;

      // Size follows reach; brightness follows momentum.
      const size = 3.5 + trendReach * 15 + (sourceCount >= 3 ? 2.5 : 0);
      const brightness = 0.35 + trendMomentum * 0.65;
      const sourceNames = [
        google ? "Google" : "",
        yahoo ? "Yahoo" : "",
        x ? "X" : "",
      ].filter(Boolean);

      // Lifecycle is accumulated from the same stable keyword across snapshots.
      const serverLifecycle = s.lifecycle as Trend["lifecycle"] | undefined;
      const serverEntityId = s.entityId ? String(s.entityId) : undefined;
      const previousPeakReach = Number(s.peakReach ?? previous?.peakReach ?? previousReach ?? 0);
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

      const lifecycle: Trend["lifecycle"] = serverLifecycle || (isNew
        ? "birth"
        : trendMomentum >= Math.max(0.72, peakMomentum * 0.94)
          ? "peak"
          : decayRate >= 0.08
            ? "decay"
            : trendReach > (previousReach ?? 0) + 0.02 || trendMomentum > (previousMomentum ?? 0) + 0.02
              ? "growth"
              : "dormant");

      return {
        id: serverEntityId || "trend:" + norm(keyword),
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
        interestBreadthScore: coordinates.interestBreadthScore,
        eventReactionScore: coordinates.eventReactionScore,
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
        semanticReason: { ...coordinates.reason, identityScore: Number(s.identityScore || 0), serverLifecycle: serverLifecycle || null },
        entityId: serverEntityId,
        firstSeenAt: s.firstSeenAt || previous?.bornAt || observed,
        identityScore: Number(s.identityScore || 0),
      } as Trend;
    })
    .filter(Boolean) as Trend[];

  // Keep a short-lived fading remnant for trends that just disappeared.
  // After several missed hourly observations the object is intentionally gone,
  // which makes the final transition visually read as "disappearance".
  const activeKeys = new Set(raw.map(t => norm(t.keyword)));
  const fading = [...previousByKeyword.values()]
    .filter(t => !activeKeys.has(norm(t.keyword)))
    .map(t => {
      const missingHours = Math.max(0, (new Date(now).getTime() - new Date(t.lastSeenAt).getTime()) / 3600000);
      if (!Number.isFinite(missingHours) || missingHours <= 0 || missingHours > 3) return null;
      const fade = clamp(1 - missingHours / 3);
      return {
        ...t,
        trendReach: t.trendReach * (0.42 + fade * 0.58),
        spreadScore: t.spreadScore * (0.42 + fade * 0.58),
        trendMomentum: t.trendMomentum * fade,
        momentumScore: t.momentumScore * fade,
        size: Math.max(2.2, t.size * (0.42 + fade * 0.58)),
        brightness: Math.max(0.08, t.brightness * fade),
        decayRate: clamp((t.decayRate || 0.08) + (1 - fade) * 0.22),
        lifecycle: "decay" as Trend["lifecycle"],
        lastSeenAt: t.lastSeenAt,
        semanticReason: { ...(t.semanticReason || {}), disappeared: true, missingHours: Number(missingHours.toFixed(2)), disappearancePhase: fade > 0.66 ? "fading" : "last-glow" },
      } as Trend;
    })
    .filter(Boolean) as Trend[];

  const laidOut = layoutTrends([...raw, ...fading]);



  const adjacency = new Map<string, Set<string>>();
  laidOut.forEach(t => adjacency.set(t.id, new Set<string>()));

  // Candidate generation keeps clustering practical at 100-1000 stars.
  // We only compare trends that share a category/token/article/media signal.
  const candidatePairs = new Set<string>();
  const buckets = new Map<string, string[]>();
  const addBucket = (key: string, id: string) => {
    if (!key) return;
    const list = buckets.get(key) || [];
    if (!list.includes(id)) list.push(id);
    buckets.set(key, list);
  };
  for (const t of laidOut) {
    const n = norm(t.keyword);
    const grams = Array.from(words(n)).slice(0, 8);
    addBucket("c:" + t.category, t.id);
    addBucket("p:" + t.category + ":" + n.slice(0, 2), t.id);
    grams.forEach(g => addBucket("g:" + t.category + ":" + g, t.id));
    t.relatedKeywords.slice(0, 8).forEach(k => addBucket("r:" + t.category + ":" + norm(k).slice(0, 2), t.id));
    t.relatedArticles.slice(0, 8).forEach(a => addBucket("a:" + a.id, t.id));
    t.relatedArticles.map(a => String(a.source || "").trim()).filter(Boolean).slice(0, 8).forEach(m => addBucket("m:" + t.category + ":" + m, t.id));
  }
  for (const [key, ids] of buckets) {
    // A whole-category bucket is too broad at scale; use it only for small categories.
    if (key.startsWith("c:") && ids.length > 90) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const pair = ids[i] < ids[j] ? ids[i] + "|" + ids[j] : ids[j] + "|" + ids[i];
      candidatePairs.add(pair);
    }
  }

  // Aggregate semantic evidence for diagnostics; do not retain per-pair logs.
  let semanticPairCompared = 0;
  let semanticPairEvidence = 0;
  let semanticPairLinked = 0;

  for (const pair of candidatePairs) {
    const [aId, bId] = pair.split("|");
    const a = laidOut.find(t => t.id === aId);
    const b = laidOut.find(t => t.id === bId);
    if (!a || !b || a.category !== b.category) continue;
    semanticPairCompared++;

    const factors = semanticTrendFactors(a, b);
    const semantic = factors.total;
    const direct = factors.keywordScore;
    const articleBridge = factors.articleScore;
    const mediaBridge = factors.mediaScore;
    const threshold =
      direct >= 0.72 || articleBridge >= 0.45 ? 0.30 :
      mediaBridge >= 0.75 ? 0.50 :
      0.46;

    if (factors.total >= 0.30 || factors.articleScore >= 0.25 || factors.mediaScore >= 0.50) {
      semanticPairEvidence++;
    }

    const linked =
      semantic >= threshold ||
      (articleBridge >= 0.60 && mediaBridge >= 0.50) ||
      (direct >= 0.55 && factors.relatedKeywordScore >= 0.55);

    if (linked) semanticPairLinked++;

    // Clustering is semantic, not geometric. Screen coordinates never decide membership.
    if (linked) {
      adjacency.get(a.id)?.add(b.id);
      adjacency.get(b.id)?.add(a.id);
    }
  }

  const visited = new Set<string>();
  const clusters: Cluster[] = [];

  for (const seed of laidOut) {
    if (visited.has(seed.id)) continue;
    const queue = [seed.id];
    const memberIds: string[] = [];
    visited.add(seed.id);

    while (queue.length) {
      const id = queue.shift()!;
      memberIds.push(id);
      for (const next of adjacency.get(id) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    if (memberIds.length < 2) continue;
    const members = memberIds.map(id => laidOut.find(t => t.id === id)).filter(Boolean) as Trend[];
    const totalWeight = Math.max(0.001, members.reduce((sum, m) => sum + 0.35 + m.trendReach, 0));
    const x = clamp(members.reduce((sum, m) => sum + m.x * (0.35 + m.trendReach), 0) / totalWeight, 0.08, 0.92);
    const y = clamp(members.reduce((sum, m) => sum + m.y * (0.35 + m.trendReach), 0) / totalWeight, 0.10, 0.90);

    const representative = members.map(member => {
      const centrality = members.filter(other => other.id !== member.id)
        .reduce((sum, other) => sum + semanticTrendSimilarity(member, other), 0) / Math.max(1, members.length - 1);
      const coverage = clamp((member.relatedArticles.length + member.relatedMediaCount) / 16);
      return {
        member,
        score: member.trendReach * 0.42 + member.trendMomentum * 0.24 + centrality * 0.22 + coverage * 0.12,
      };
    }).sort((a,b) => b.score - a.score)[0].member;

    const relatedArticles = Array.from(
      new Map(members.flatMap(m => m.relatedArticles).map(article => [article.id, article])).values()
    ).sort((a,b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()).slice(0,12);
    const mediaNames = new Set(relatedArticles.map(article => String(article.source || "").trim()).filter(Boolean));
    const clusterReach = clamp(
      members.reduce((sum,m) => sum + m.trendReach,0) / members.length * 0.62 +
      Math.max(...members.map(m => m.trendReach)) * 0.38
    );
    const clusterMomentum = clamp(
      members.reduce((sum,m) => sum + m.trendMomentum,0) / members.length * 0.58 +
      Math.max(...members.map(m => m.trendMomentum)) * 0.42
    );
    const averagePairSimilarity = members.length <= 1 ? 1 : members.reduce((sum,member) => {
      const others = members.filter(other => other.id !== member.id);
      return sum + others.reduce((inner,other) => inner + semanticTrendSimilarity(member,other),0) / Math.max(1,others.length);
    },0) / members.length;

    clusters.push({
      id: "cluster:" + norm(representative.keyword),
      representativeKeyword: representative.keyword,
      trendIds: members.map(m => m.id),
      x, y,
      size: 30 + members.length * 10 + clusterReach * 42,
      category: representative.category,
      relatedness: clamp(averagePairSimilarity),
      clusterReach,
      clusterMomentum,
      relatedArticles,
      relatedMediaCount: mediaNames.size,
    });
  }

  // Keep diagnostics compact: log only the aggregate signals needed to verify
  // semantic placement and clustering. Individual stars/pairs are intentionally not
  // sent to the server because that creates noisy, expensive logs.
  const xValues = laidOut.map(t => t.x);
  const yValues = laidOut.map(t => t.y);
  const duplicateXY = new Map<string, number>();
  laidOut.forEach(t => {
    const key = `${t.x.toFixed(3)},${t.y.toFixed(3)}`;
    duplicateXY.set(key, (duplicateXY.get(key) || 0) + 1);
  });
  const semanticConfidence = laidOut.map(t => Number((t.semanticReason?.confidence ?? 0))).filter(Number.isFinite);
  const eventScores = laidOut.map(t => t.eventReactionScore).filter(Number.isFinite);
  const breadthScores = laidOut.map(t => t.interestBreadthScore).filter(Number.isFinite);
  const lifecycleCounts = laidOut.reduce<Record<string, number>>((acc, t) => {
    acc[t.lifecycle] = (acc[t.lifecycle] || 0) + 1;
    return acc;
  }, {});
  const clusterMemberCounts = clusters.map(c => c.trendIds.length);
  const semanticSummary = {
    version: "semantic-coordinate-v3-evidence-breadth",
    count: laidOut.length,
    bounds: { xMin: 0.16, xMax: 0.84, yMin: 0.16, yMax: 0.84 },
    xRange: xValues.length ? [Number(Math.min(...xValues).toFixed(4)), Number(Math.max(...xValues).toFixed(4))] : [],
    yRange: yValues.length ? [Number(Math.min(...yValues).toFixed(4)), Number(Math.max(...yValues).toFixed(4))] : [],
    duplicateCoordinateGroups: [...duplicateXY.values()].filter(count => count > 1).length,
    semanticConfidenceAvg: semanticConfidence.length
      ? Number((semanticConfidence.reduce((a, b) => a + b, 0) / semanticConfidence.length).toFixed(3))
      : 0,
    eventReactionAvg: eventScores.length
      ? Number((eventScores.reduce((a, b) => a + b, 0) / eventScores.length).toFixed(3))
      : 0,
    interestBreadthAvg: breadthScores.length
      ? Number((breadthScores.reduce((a, b) => a + b, 0) / breadthScores.length).toFixed(3))
      : 0,
    lifecycleCounts,
    clusters: clusters.length,
    clusteredStars: clusterMemberCounts.reduce((sum, n) => sum + n, 0),
    largestCluster: clusterMemberCounts.length ? Math.max(...clusterMemberCounts) : 0,
    semanticPairs: {
      candidates: candidatePairs.size,
      compared: semanticPairCompared,
      evidence: semanticPairEvidence,
      linked: semanticPairLinked,
    },
    axisSemantics: "X=LOCAL/NICHE→SOCIETY-WIDE; Y=EVENT/FACT→REACTION/OPINION",
    placementSource: "semantic-coordinate",
    nearestKeywordUsedForPlacement: false,
    collisionCorrectionMax: 0.006,
  };

  void fetch("/api/emails", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "trend_position_diagnostics", payload: semanticSummary }),
  }).catch(() => {});

  const dust = laidOut
    .filter(t => t.spreadScore < 0.42 || (t.lifecycle === "birth" && t.trendMomentum < 0.34))
    .slice(0, 80)
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
      interestBreadthScore: (t.interestBreadthScore ?? t.spreadScore) + ((other.interestBreadthScore ?? other.spreadScore) - (t.interestBreadthScore ?? t.spreadScore)) * at,
      eventReactionScore: (t.eventReactionScore ?? t.natureScore) + ((other.eventReactionScore ?? other.natureScore) - (t.eventReactionScore ?? t.natureScore)) * at,
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

  useEffect(() => {
    // The app is display-only: external trend/news collection happens exclusively
    // through GitHub Actions -> /api/trend-history. Opening the app only reads
    // the already stored hourly snapshots from Vercel Blob.
    const hydrate = async () => {
      const local = readHistory();
      setHistory(local);
      try {
        const r = await fetch("/api/trend-history?hours=24", { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          const rawSnapshots = Array.isArray(d?.snapshots) ? d.snapshots : [];
          let hydrated: Snapshot[] = [];
          for (const item of rawSnapshots) {
            const u = buildUniverse(item.payload || item, item.timestamp, hydrated);
            hydrated.push({ timestamp: u.timestamp, universe: u });
          }
          hydrated = hydrated.slice(-24);
          if (hydrated.length) {
            setHistory(hydrated);
            const latest = hydrated[hydrated.length - 1];
            setUniverse(latest.universe);
            setHistoryIndex(hydrated.length - 1);
            setLive(true);
            console.info("[TREND_UNIVERSE] durable_history_restored", {
              snapshots: hydrated.length,
              from: hydrated[0]?.timestamp,
              to: latest.timestamp,
              sliderEnabled: hydrated.length > 1,
              source: "github-actions-history",
            });
          } else if (local.length) {
            const latest = local[local.length - 1];
            setUniverse(latest.universe);
            setHistoryIndex(local.length - 1);
            setLive(true);
          }
        } else if (local.length) {
          const latest = local[local.length - 1];
          setUniverse(latest.universe);
          setHistoryIndex(local.length - 1);
          setLive(true);
        }
      } catch (e) {
        console.warn("[TREND_UNIVERSE] durable_history_unavailable", { reason: e instanceof Error ? e.message : "unknown" });
        if (local.length) {
          const latest = local[local.length - 1];
          setUniverse(latest.universe);
          setHistoryIndex(local.length - 1);
          setLive(true);
        }
      } finally {
        setLoading(false);
      }
    };
    void hydrate();
  }, []);


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

  // Level-of-detail: render only the strongest 420 stars as interactive DOM at once.
  // We keep all trends in memory/history; weak stars remain represented by clusters/dust.
  const displayedTrends = useMemo(() => {
    const trends = visibleUniverse?.trends || [];
    if (trends.length <= 420) return trends;
    return [...trends].sort((a,b) => (b.trendReach * .55 + b.trendMomentum * .35 + b.brightness * .10) - (a.trendReach * .55 + a.trendMomentum * .35 + a.brightness * .10)).slice(0,420);
  }, [visibleUniverse]);
  useEffect(() => {
    if (!visibleUniverse) return;
    console.info("[TREND_UNIVERSE] render_ready", { trends: visibleUniverse.trends.length, clusters: visibleUniverse.clusters.length, history: history.length, historyIndex });
  }, [visibleUniverse, history.length, historyIndex]);
  const selectedMembers = selectedCluster ? displayedTrends.filter(t => selectedCluster.trendIds.includes(t.id)) : [];
  const selectedSystem = selectedTrend
    ? displayedTrends.filter(t => t.id === selectedTrend.id || similarity(t.keyword, selectedTrend.keyword) > 0.28 || selectedTrend.relatedKeywords.includes(t.keyword)).slice(0, 9)
    : [];

  const openCluster = (cluster: Cluster) => {
    const members = displayedTrends.filter(t => cluster.trendIds.includes(t.id));
    console.info("[TREND_CLUSTER] expand_request", {
      clusterId: cluster.id,
      representativeKeyword: cluster.representativeKeyword,
      memberCount: cluster.trendIds.length,
      visibleMemberCount: members.length,
      members: members.map(t => t.keyword),
    });
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
.star-core { position:relative; display:block; width:var(--s); height:var(--s); border-radius:50%; background:radial-gradient(circle, #fff 0%, var(--c) 32%, color-mix(in srgb,var(--c) 55%,transparent) 60%, transparent 72%); box-shadow:0 0 calc(var(--s)*1.2) color-mix(in srgb,var(--c) 48%,transparent); opacity:var(--b); transition:width .7s,height .7s,opacity .7s,box-shadow .7s,transform .7s; will-change:transform,opacity,width,height; }
        .lifecycle-birth { animation:life-birth 1.6s ease-out both; }
        .lifecycle-growth { animation:life-growth 2.4s ease-in-out infinite alternate; }
        .lifecycle-peak { animation:life-peak 2.8s ease-in-out infinite; }
        .lifecycle-decay { animation:life-decay 2.8s ease-in-out infinite alternate; }
        .lifecycle-dormant { animation:life-dormant 4s ease-in-out infinite alternate; }
        @keyframes life-birth { 0%{transform:scale(.08);opacity:0} 55%{transform:scale(1.35);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes life-growth { from{transform:scale(.94);filter:brightness(.9)} to{transform:scale(1.10);filter:brightness(1.18)} }
        @keyframes life-peak { 0%,100%{transform:scale(1);filter:brightness(1)} 50%{transform:scale(1.16);filter:brightness(1.3)} }
        @keyframes life-decay { from{transform:scale(.98);opacity:var(--b)} to{transform:scale(.78);opacity:calc(var(--b)*.62)} }
        @keyframes life-dormant { from{opacity:var(--b)} to{opacity:calc(var(--b)*.78)} }
        .star[data-lifecycle="disappeared"] { animation:life-disappear 2s ease-out forwards; pointer-events:none; }
        @keyframes life-disappear { 0%{opacity:.75;transform:scale(1)} 70%{opacity:.12;transform:scale(.35)} 100%{opacity:0;transform:scale(.05)} }
        .star:hover .star-core, .star:active .star-core { transform:scale(1.18); }
        .cluster { position:absolute; transform:translate(-50%,-50%); border:0; background:transparent; padding:0; color:white; cursor:pointer; width:var(--cs); height:var(--cs); }
        .cluster-cloud { position:absolute; inset:0; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb,var(--cc) 18%,transparent), transparent 66%); filter:blur(1px); pointer-events:none; }
        .cluster-dot { position:absolute; width:4px; height:4px; border-radius:50%; background:var(--cc); box-shadow:0 0 8px color-mix(in srgb,var(--cc) 65%,transparent); opacity:.82; }
        .cluster-dot:nth-child(2){left:35%;top:40%}.cluster-dot:nth-child(3){left:58%;top:31%}.cluster-dot:nth-child(4){left:70%;top:54%}.cluster-dot:nth-child(5){left:42%;top:65%}.cluster-dot:nth-child(6){left:25%;top:55%}.cluster-dot:nth-child(7){left:54%;top:51%}
        .cluster-expansion-core { position:absolute; width:12px; height:12px; border-radius:50%; transform:translate(-50%,-50%); background:#fff; box-shadow:0 0 8px #fff,0 0 22px var(--cc),0 0 42px var(--cc); animation:cluster-core-pulse .72s ease-out forwards; }
        @keyframes cluster-core-pulse { from { opacity:.2; transform:translate(-50%,-50%) scale(.5); } 35% { opacity:1; transform:translate(-50%,-50%) scale(1.25); } to { opacity:.82; transform:translate(-50%,-50%) scale(1); } }
        .cluster-system { position:absolute; z-index:25; inset:0; width:100%; height:100%; opacity:1; pointer-events:none; }
        .cluster-burst { position:absolute; left:var(--cx); top:var(--cy); width:var(--len); height:2px; transform-origin:0 50%; transform:rotate(var(--angle)) scaleX(.12); background:linear-gradient(90deg, var(--cc), rgba(255,255,255,.68), transparent); box-shadow:0 0 8px var(--cc); opacity:0; animation:cluster-burst-open .72s cubic-bezier(.2,.8,.2,1) forwards; }
        .cluster-member-star { position:absolute; z-index:35; left:var(--mx); top:var(--my); width:var(--ms); height:var(--ms); padding:0; border:0; border-radius:50%; background:radial-gradient(circle, #fff 0%, var(--mc) 35%, transparent 74%); box-shadow:0 0 14px var(--mc),0 0 28px color-mix(in srgb,var(--mc) 45%,transparent); transform:translate(-50%,-50%) scale(.2); opacity:0; cursor:pointer; pointer-events:auto; animation:cluster-member-open .72s cubic-bezier(.2,.8,.2,1) forwards; }
        .cluster-member-star:hover,.cluster-member-star:active { transform:translate(-50%,-50%) scale(1.35); }
        @keyframes cluster-burst-open { from { opacity:0; transform:rotate(var(--angle)) scaleX(.12); } to { opacity:.82; transform:rotate(var(--angle)) scaleX(1); } }
        @keyframes cluster-member-open { from { opacity:0; transform:translate(-50%,-50%) scale(.2); } to { opacity:.95; transform:translate(-50%,-50%) scale(1); } }
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
              onPointerDown={e => e.stopPropagation()}
              onPointerUp={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); openCluster(c); }}
              aria-label="トレンド星団"
            >
              <span className="cluster-cloud" />
              {[0,1,2,3,4,5].map(i => <span className="cluster-dot" key={i} />)}
            </button>
          ))}

          {selectedCluster && viewMode === "cluster" && (() => {
            const members = (visibleUniverse?.trends || []).filter(t => selectedCluster.trendIds.includes(t.id));
            const bursts = Array.from({ length: Math.min(18, Math.max(8, members.length * 3)) });
            return (
              <div
                className="cluster-system"
                style={{ ["--cc" as any]: CATEGORY_COLORS[selectedCluster.category] || CATEGORY_COLORS.other }}
                aria-hidden="true"
              >
                <span
                  className="cluster-expansion-core"
                  style={{ left: `${selectedCluster.x * 100}%`, top: `${selectedCluster.y * 100}%` }}
                />
                {bursts.map((_, i) => (
                  <span key={`burst-${i}`} className="cluster-burst" style={{ ["--angle" as any]: `${(360 / bursts.length) * i}deg`, ["--len" as any]: `${56 + (i % 4) * 18}px`, ["--cx" as any]: `${selectedCluster.x * 100}%`, ["--cy" as any]: `${selectedCluster.y * 100}%` }} />
                ))}
                {members.map((member, index) => {
                  const p = clusterMemberPosition(selectedCluster, member, index, members.length);
                  return (
                    <button
                      key={member.id}
                      className="cluster-member-star"
                      style={{
                        ["--mx" as any]: p.x * 100 + "%",
                        ["--my" as any]: p.y * 100 + "%",
                        ["--ms" as any]: Math.max(7, Math.min(18, member.size * .95)) + "px",
                        ["--mc" as any]: member.color,
                        animationDelay: 80 + index * 45 + "ms",
                      }}
                      onPointerDown={e => e.stopPropagation()}
                      onPointerUp={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); openTrend(member); }}
                      aria-label={member.keyword}
                      title={member.keyword}
                    />
                  );
                })}
              </div>
            );
          })()}

          {displayedTrends.map(t => {
            const inCluster = visibleUniverse?.clusters.some(c => c.trendIds.includes(t.id));
            if (inCluster) return null;
            const active = searchMatch?.id === t.id;
            return (
              <button
                key={t.id}
                className="star"
                style={{
                  ["data-lifecycle" as any]: t.lifecycle,
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  ["--s" as any]: `${Math.max(3, t.size * (active ? 1.3 : 1))}px`,
                  ["--b" as any]: t.brightness,
                  ["--c" as any]: t.color,
                }}
                onClick={e => { e.stopPropagation(); openTrend(t); }}
                aria-label={t.keyword}
              >
                <span className={`star-core lifecycle-${t.lifecycle}`} />
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
                <p className="panel-copy">意味的に結びついたトレンドを1つの星団として扱っている。中心星を軸に、関連ニュース・関連媒体・星団全体の勢いをまとめて観測できる。</p>
                <div className="source-grid">
                  <div className="source-cell"><span>CLUSTER REACH</span><strong>{selectedCluster.clusterReach !== undefined ? Math.round(selectedCluster.clusterReach * 100) : "—"}</strong></div>
                  <div className="source-cell"><span>MOMENTUM</span><strong>{selectedCluster.clusterMomentum !== undefined ? Math.round(selectedCluster.clusterMomentum * 100) : "—"}</strong></div>
                  <div className="source-cell"><span>STARS</span><strong>{selectedCluster.trendIds.length}</strong></div>
                </div>
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
