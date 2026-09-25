"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  paywalled?: boolean;
  source?: string;
  fetchError?: string;
};

type ReaderTarget = {
  emailId: string;
  newsIndex: number;
  data?: ReaderData;
};

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

function iconFor(kind: Email["kind"]) {
  if (kind === "朝刊") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (kind === "昼刊") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" />
        <path d="M12 4.8v14.4M4.8 12h14.4" />
      </svg>
    );
  }
  if (kind === "夕刊") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18.6 15.7A8 8 0 0 1 8.3 5.4 8.4 8.4 0 1 0 18.6 15.7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

function latestRegular(emails: Email[]) {
  return emails.find((email) => email.kind !== "速報" && email.news.length > 0);
}

function latestRegularIssues(emails: Email[]) {
  const regular = emails
    .filter((email) => email.kind !== "速報" && email.news.length > 0)
    .slice()
    .sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

  const seen = new Set<string>();
  const result: Email[] = [];

  for (const email of regular) {
    const issueKey = [
      email.issueDate || dateKey(email.internalDate || email.receivedAt),
      email.kind,
    ].join("|");

    if (seen.has(issueKey)) continue;
    seen.add(issueKey);
    result.push(email);

    if (result.length >= 3) break;
  }

  return result;
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
  const [swipeX, setSwipeX] = useState(0);
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);
  const [swipeAction, setSwipeAction] = useState<"save" | "remove" | "home" | null>(null);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchActiveRef = useRef(false);

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

  const breakingEmail = useMemo(() => emails.find((email) => email.kind === "速報" && email.news.length > 0), [emails]);
  const latest = useMemo(() => latestRegular(emails), [emails]);
  const latestIssues = useMemo(() => latestRegularIssues(emails), [emails]);
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

  const homeIssues = latestIssues;

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

  function finishHorizontalSwipe(dx: number) {
    const threshold = 90;
    if (Math.abs(dx) < threshold || isSwipeAnimating) {
      setSwipeX(0);
      setSwipeAction(null);
      return;
    }

    // 通常のShorts:
    //   左 = ホームへ戻る
    //   右 = 保存して次の記事
    //
    // 「あとで読む」:
    //   左 = ホームへ戻る
    //   右 = 保存解除して次の記事
    if (dx < 0) {
      setSwipeAction("home");
      setIsSwipeAnimating(true);

      window.setTimeout(() => {
        setSwipeX(0);
        setSwipeAction(null);
        setIsSwipeAnimating(false);
        closeShorts();
      }, 230);
      return;
    }

    // 通常のShortsの右スワイプは保存して次の記事へ。
    if (!savedMode) {
      setSwipeAction("save");
      setIsSwipeAnimating(true);

      const email = selectedIssue;
      const index = shortIndex;

      window.setTimeout(() => {
        if (email) saveNews(email, index);

        setSwipeX(0);
        setSwipeAction(null);
        setIsSwipeAnimating(false);

        const count = email?.news.length || 0;
        if (index < count - 1) {
          setShortIndex(index + 1);
        } else {
          closeShorts();
        }
      }, 230);
      return;
    }

    // 「あとで読む」では右スワイプで保存解除して次の記事へ。
    setSwipeAction("remove");
    setIsSwipeAnimating(true);

    const item = savedNews[shortIndex];

    window.setTimeout(() => {
      if (item) {
        setSaved((current) =>
          current.filter(
            (savedItem) =>
              !(savedItem.emailId === item.email.id && savedItem.newsIndex === item.newsIndex),
          ),
        );
      }

      setSwipeX(0);
      setSwipeAction(null);
      setIsSwipeAnimating(false);

      const nextLength = Math.max(0, savedNews.length - 1);
      if (nextLength === 0) {
        closeShorts();
      } else if (shortIndex >= nextLength) {
        setShortIndex(nextLength - 1);
      } else {
        setShortIndex(shortIndex);
      }
    }, 230);
  }

  function handleShortSwipe(dx: number, dy: number) {
    if (Math.abs(dy) > Math.abs(dx)) {
      if (Math.abs(dy) < 55) {
        setSwipeX(0);
        return;
      }
      setSwipeX(0);
      if (dy < 0) moveShort(1);
      else moveShort(-1);
      return;
    }

    finishHorizontalSwipe(dx);
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
              <>
                <div className="article-content" style={{ fontSize: fontScale + "em" }} dangerouslySetInnerHTML={{ __html: reader.data.contentHtml }} />
                {reader.data.paywalled && (
                  <div className="paywall-notice">
                    <strong>ここから先は有料会員限定</strong>
                    <p>この記事は有料会員限定記事です。続きは日経の有料会員向けページで読むことができます。</p>
                  </div>
                )}
              </>
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

    return (
      <main
        className="app-shell shorts-shell"
        onTouchStart={(event) => {
          touchStartXRef.current = event.changedTouches[0]?.clientX || 0;
          touchStartYRef.current = event.changedTouches[0]?.clientY || 0;
          touchActiveRef.current = true;
          setIsSwipeAnimating(false);
          setSwipeAction(null);
        }}
        onTouchMove={(event) => {
          if (!touchActiveRef.current || isSwipeAnimating) return;
          const x = event.changedTouches[0]?.clientX || 0;
          const y = event.changedTouches[0]?.clientY || 0;
          const dx = x - touchStartXRef.current;
          const dy = y - touchStartYRef.current;

          // 縦スワイプ中はカードを左右に動かさない。
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
            setSwipeX(0);
            return;
          }

          if (Math.abs(dx) > 8) {
            setSwipeX(dx);
          }
        }}
        onTouchEnd={(event) => {
          if (!touchActiveRef.current) return;
          touchActiveRef.current = false;
          const endX = event.changedTouches[0]?.clientX || 0;
          const endY = event.changedTouches[0]?.clientY || 0;
          handleShortSwipe(
            endX - touchStartXRef.current,
            endY - touchStartYRef.current,
          );
        }}
      >
        <div className="shorts-header">
          <button type="button" className="icon-button" aria-label="ホーム" onClick={closeShorts}>‹</button>
          <div className="shorts-title">{label}</div>
          <div className="shorts-count">{shortIndex + 1} / {total}</div>
        </div>
        <div className="shorts-progress"><span style={{ width: total ? ((shortIndex + 1) / total) * 100 + "%" : "0%" }} /></div>

        <div className="shorts-stage">
          <div
            className={"short-card " + (isSwipeAnimating ? "is-swiping-away" : "")}
            style={{
              transform: isSwipeAnimating
                ? `translate3d(${swipeX >= 0 ? "calc(100vw + 120px)" : "calc(-100vw - 120px)"},0,0) rotate(${swipeX >= 0 ? 10 : -10}deg)`
                : `translate3d(${swipeX}px,0,0) rotate(${swipeX * 0.035}deg)`,
              opacity: isSwipeAnimating ? 0 : Math.max(0.55, 1 - Math.abs(swipeX) / 420),
              transition: isSwipeAnimating
                ? "transform .23s cubic-bezier(.22,.7,.2,1), opacity .23s ease"
                : "none",
            }}
          >
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
        {homeIssues.map((email) => (
          <button
            type="button"
            className="issue-icon"
            key={email.id}
            aria-label={email.kind}
            onClick={() => startIssue(email)}
          >
            <span className="issue-symbol">{iconFor(email.kind)}</span>
            <span className="issue-label">{email.kind}</span>
            <span className="issue-count">{email.news.length}</span>
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
