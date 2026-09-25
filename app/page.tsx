"use client";

import { useEffect, useMemo, useState } from "react";

type News = {
  title: string;
  body: string;
  url?: string;
  index: number;
  section?: string;
  imageUrl?: string;
  imageAlt?: string;
};

type Email = {
  id: string;
  subject: string;
  receivedAt: string;
  internalDate: string;
  issueDate?: string;
  kind: "朝刊" | "昼刊" | "夕刊" | "速報";
  from: string;
  newsCount: number;
  news: News[];
};

type ReaderData = {
  title: string;
  imageUrl: string;
  contentHtml: string;
  url: string;
  available: boolean;
  source?: string;
  fetchError?: string;
};

type ReaderTarget = {
  emailId: string;
  newsIndex: number;
  data?: ReaderData;
};

const HOUR_START = {
  朝刊: 5,
  昼刊: 11,
  夕刊: 17,
} as const;

function haptic(pattern: number | number[] = 8) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

function dateKey(value: string | number | Date) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((part) => part.type === "year")?.value || "";
  const m = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return y && m && day ? `${y}-${m}-${day}` : "";
}

function addDays(key: string, amount: number) {
  const d = new Date(key + "T12:00:00+09:00");
  d.setDate(d.getDate() + amount);
  return dateKey(d);
}

function todayKey() {
  return dateKey(new Date());
}

function getTimeSlots(now = new Date()): Array<{ kind: "朝刊" | "昼刊" | "夕刊"; offset: number }> {
  const hour = Number(
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  if (hour >= HOUR_START.夕刊) {
    return [
      { kind: "夕刊", offset: 0 },
      { kind: "昼刊", offset: 0 },
      { kind: "朝刊", offset: 0 },
    ];
  }

  if (hour >= HOUR_START.昼刊) {
    return [
      { kind: "昼刊", offset: 0 },
      { kind: "朝刊", offset: 0 },
      { kind: "夕刊", offset: -1 },
    ];
  }

  return [
    { kind: "朝刊", offset: 0 },
    { kind: "夕刊", offset: -1 },
    { kind: "昼刊", offset: -1 },
  ];
}

function pickIssue(emails: Email[], kind: "朝刊" | "昼刊" | "夕刊", targetDate: string) {
  const candidates = emails
    .filter((email) => email.kind === kind && email.news.length > 0)
    .sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

  // まず指定日の刊を探す。見つからない場合は、その日以前で一番新しい同じ刊を使う。
  // Gmail側の配信遅延や休日などで「今日の刊」がまだ存在しない場合でも、
  // ホームの刊ボタンが0件にならないようにする。
  return (
    candidates.find((email) => (email.issueDate || dateKey(email.internalDate || email.receivedAt)) === targetDate) ||
    candidates.find((email) => (email.issueDate || dateKey(email.internalDate || email.receivedAt)) < targetDate)
  );
}

function latestRegular(emails: Email[]) {
  return emails.find((email) => email.kind !== "速報");
}

function newsImageSrc(news?: News) {
  return news?.url ? "/api/news-image?url=" + encodeURIComponent(news.url) : "";
}

function preloadIssueImages(email: Email, startIndex: number, count = 6) {
  for (let i = Math.max(0, startIndex); i < Math.min(email.news.length, startIndex + count); i++) {
    const src = newsImageSrc(email.news[i]);
    if (!src) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }
}

export default function Home() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<Email | null>(null);
  const [saved, setSaved] = useState<Array<{ emailId: string; newsIndex: number }>>([]);
  const [reader, setReader] = useState<ReaderTarget | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fontScale, setFontScale] = useState(1);
  const [shortIndex, setShortIndex] = useState(0);
  const [savedMode, setSavedMode] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("nn_saved_news");
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("nn_saved_news", JSON.stringify(saved));
  }, [saved]);

  // Shortsを開いた瞬間に、現在位置から先の写真を先読みする。
  // スワイプ後に古い画像が残るのを防ぐため、次の5件＋現在位置をブラウザキャッシュへ入れる。
  useEffect(() => {
    if (!selectedIssue || savedMode) return;
    preloadIssueImages(selectedIssue, shortIndex, 6);
    if (shortIndex > 0) preloadIssueImages(selectedIssue, shortIndex - 1, 2);
  }, [selectedIssue, savedMode, shortIndex]);

  useEffect(() => {
    fetch("/api/emails", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) throw new Error("Googleアカウントを接続してください。");
        if (!r.ok) throw new Error(j.error || "メールを取得できませんでした");
        setEmails(j.emails || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "メールを取得できませんでした"))
      .finally(() => setLoading(false));
  }, []);

  const slots = useMemo(() => getTimeSlots(now), [now]);
  const breakingEmail = useMemo(() => emails.find((email) => email.kind === "速報" && email.news.length > 0), [emails]);
  const latest = useMemo(() => latestRegular(emails), [emails]);
  const savedNews = useMemo(() => {
    return saved
      .map((item) => {
        const email = emails.find((candidate) => candidate.id === item.emailId);
        const news = email?.news[item.newsIndex];
        return email && news ? { email, news, newsIndex: item.newsIndex } : null;
      })
      .filter(Boolean) as Array<{ email: Email; news: News; newsIndex: number }>;
  }, [emails, saved]);

  useEffect(() => {
    if (!savedMode) return;
    for (let i = shortIndex; i < Math.min(savedNews.length, shortIndex + 6); i++) {
      const src = newsImageSrc(savedNews[i]?.news);
      if (!src) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    }
  }, [savedMode, shortIndex, savedNews]);

  const homeIssues = useMemo(
    () =>
      slots.map((slot) => {
        const target = addDays(todayKey(), slot.offset);
        return { ...slot, targetDate: target, email: pickIssue(emails, slot.kind, target) };
      }),
    [emails, slots],
  );

  function startIssue(email: Email) {
    if (!email.news.length) return;
    haptic(10);
    setSavedMode(false);
    setSelectedIssue(email);
    setShortIndex(0);
    preloadIssueImages(email, 0, 8);
  }

  function startSaved() {
    if (!savedNews.length) return;
    haptic(10);
    setSavedMode(true);
    setSelectedIssue(null);
    setShortIndex(0);
  }

  function closeShorts() {
    haptic(6);
    setSelectedIssue(null);
    setSavedMode(false);
    setShortIndex(0);
  }

  async function openReader(email: Email, newsIndex: number) {
    const news = email.news[newsIndex];
    if (!news) return;

    haptic(8);
    setReader({ emailId: email.id, newsIndex });
    setReaderLoading(true);
    setFontScale(1);

    try {
      const params = new URLSearchParams({
        url: news.url || "",
        title: news.title,
        body: news.body || "",
      });
      const r = await fetch("/api/article?" + params.toString(), { cache: "no-store" });
      const data = await r.json();
      if (r.ok) setReader((current) => (current ? { ...current, data } : current));
    } catch {
    } finally {
      setReaderLoading(false);
    }
  }

  function saveNews(email: Email, newsIndex: number) {
    setSaved((current) => {
      if (current.some((item) => item.emailId === email.id && item.newsIndex === newsIndex)) return current;
      return [...current, { emailId: email.id, newsIndex }];
    });
    haptic(10);
  }

  function moveShort(direction: 1 | -1) {
    const count = savedMode ? savedNews.length : selectedIssue?.news.length || 0;
    if (!count) return;

    const next = shortIndex + direction;
    if (next < 0 || next >= count) return;

    haptic(8);
    setShortIndex(next);
  }

  function handleShortSwipe(dx: number, dy: number) {
    if (Math.abs(dx) < 55 && Math.abs(dy) < 55) return;

    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) moveShort(1);
      else moveShort(-1);
      return;
    }

    if (dx > 0) {
      closeShorts();
    } else {
      if (savedMode) {
        const item = savedNews[shortIndex];
        if (item) saveNews(item.email, item.newsIndex);
      } else if (selectedIssue) {
        saveNews(selectedIssue, shortIndex);
      }
    }
  }

  function currentShortNews() {
    if (savedMode) {
      const item = savedNews[shortIndex];
      return item ? { email: item.email, news: item.news, newsIndex: item.newsIndex } : null;
    }
    if (!selectedIssue) return null;
    return { email: selectedIssue, news: selectedIssue.news[shortIndex], newsIndex: shortIndex };
  }

  const short = currentShortNews();

  if (loading) {
    return <main className="app-shell"><div className="loading">日経ニュースを読み込んでいます…</div></main>;
  }

  if (error) {
    return (
      <main className="app-shell">
        <div className="connect-card">
          <div className="eyebrow">NIKKEI NEWS MAIL</div>
          <h1>日経ニュース</h1>
          <p>{error}</p>
          <a className="btn" href="/api/auth/google">Googleで接続</a>
        </div>
      </main>
    );
  }

  if (reader) {
    const email = emails.find((item) => item.id === reader.emailId);
    const news = email?.news[reader.newsIndex];
    return (
      <main className="app-shell reader-shell">
        <div className="reader-overlay">
          <header className="safari-reader-bar">
            <button type="button" className="reader-back" onClick={() => { haptic(8); setReader(null); }}>‹ <span>戻る</span></button>
            <div className="reader-controls">
              <button type="button" onClick={() => setFontScale((v) => Math.max(.9, v - .1))}>A−</button>
              <span>NEWS READER</span>
              <button type="button" onClick={() => setFontScale((v) => Math.min(1.3, v + .1))}>A＋</button>
            </div>
          </header>
          <article className="safari-reader">
            {reader.data?.imageUrl && <img className="reader-hero" src={reader.data.imageUrl} alt="" />}
            <h1>{reader.data?.title || news?.title}</h1>
            {readerLoading ? (
              <div className="reader-loading">記事を読み込んでいます…</div>
            ) : reader.data?.contentHtml ? (
              <div className="article-content" style={{ fontSize: fontScale + "em" }} dangerouslySetInnerHTML={{ __html: reader.data.contentHtml }} />
            ) : (
              <div className="reader-unavailable">
                <p>{news?.body || "本文を取得できませんでした。"}</p>
              </div>
            )}
          </article>
        </div>
      </main>
    );
  }

  if (short) {
    const total = savedMode ? savedNews.length : selectedIssue?.news.length || 0;
    const label = savedMode ? "あとで読む" : short.email.kind;
    const imageSrc = newsImageSrc(short.news);

    let touchStartX = 0;
    let touchStartY = 0;

    return (
      <main
        className="app-shell shorts-shell"
        onTouchStart={(event) => {
          touchStartX = event.changedTouches[0]?.clientX || 0;
          touchStartY = event.changedTouches[0]?.clientY || 0;
        }}
        onTouchEnd={(event) => {
          const endX = event.changedTouches[0]?.clientX || 0;
          const endY = event.changedTouches[0]?.clientY || 0;
          handleShortSwipe(endX - touchStartX, endY - touchStartY);
        }}
      >
        <div className="shorts-header">
          <button type="button" className="icon-button" aria-label="ホーム" onClick={closeShorts}>‹</button>
          <div className="shorts-title">{label}</div>
          <div className="shorts-count">{shortIndex + 1} / {total}</div>
        </div>
        <div className="shorts-progress"><span style={{ width: total ? ((shortIndex + 1) / total) * 100 + "%" : "0%" }} /></div>

        <div className="shorts-stage">
          <div className="short-card">
            <div className="short-image">
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt={short.news.imageAlt || ""}
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                    const placeholder = event.currentTarget.nextElementSibling as HTMLElement | null;
                    if (placeholder) placeholder.hidden = false;
                  }}
                />
              ) : null}
              <div className="image-placeholder" hidden={Boolean(imageSrc)}><span>N</span></div>
            </div>
            <button type="button" className="short-title" onClick={() => openReader(short.email, short.newsIndex)}>
              {short.news.title}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const homePrimary = breakingEmail?.news[0] || latest?.news[0] || null;
  const homePrimaryEmail = breakingEmail || latest || null;
  const homeImage = homePrimary?.url ? "/api/news-image?url=" + encodeURIComponent(homePrimary.url) : "";

  return (
    <main className="app-shell home-shell">
      <header className="home-header">
        <div className="eyebrow">NIKKEI NEWS MAIL</div>
        <h1>ニュース</h1>
      </header>

      <section className={"home-hero " + (breakingEmail ? "is-breaking" : "")}>
        <div className="home-hero-image">
          {homeImage ? (
            <img
              src={homeImage}
              alt={homePrimary?.imageAlt || ""}
              onError={(event) => {
                event.currentTarget.style.display = "none";
                const placeholder = event.currentTarget.nextElementSibling as HTMLElement | null;
                if (placeholder) placeholder.hidden = false;
              }}
            />
          ) : null}
          <div className="image-placeholder" hidden={Boolean(homeImage)}><span>N</span></div>
        </div>
        <div className="home-hero-meta">{breakingEmail ? "⚡ 速報" : "TODAY"}</div>
        <button
          type="button"
          className="home-hero-title"
          onClick={() => homePrimaryEmail && openReader(homePrimaryEmail, 0)}
          disabled={!homePrimaryEmail || !homePrimary}
        >
          {homePrimary?.title || "ニュースメールを待っています"}
        </button>
      </section>

      <nav className="issue-nav" aria-label="ニュース刊">
        {homeIssues.map((item) => (
          <button
            type="button"
            className={"issue-icon " + (!item.email ? "is-empty" : "")}
            key={item.kind + item.targetDate}
            aria-label={item.email ? item.kind : item.kind + "はありません"}
            disabled={!item.email}
            onClick={() => item.email && startIssue(item.email)}
          >
            <span className="issue-symbol">{iconFor(item.kind)}</span>
            <span className="issue-label">{item.kind}</span>
            <span className="issue-count">{item.email?.news.length || 0}</span>
          </button>
        ))}
        <button
          type="button"
          className={"issue-icon saved-icon " + (!savedNews.length ? "is-empty" : "")}
          aria-label="あとで読む"
          onClick={startSaved}
          disabled={!savedNews.length}
        >
          <span className="issue-symbol">▱</span>
          <span className="issue-label">保存</span>
          <span className="issue-count">{savedNews.length}</span>
        </button>
      </nav>
    </main>
  );
}
