'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  CircleDollarSign,
  Globe2,
  Languages,
  MessageCircle,
  MountainSnow,
  Route,
  Snowflake,
  Users,
  Vote,
} from "lucide-react";

type Locale = "en" | "zh-TW";

type Copy = {
  brand: string;
  editionBadge: string;
  nav: {
    story: string;
    commands: string;
    languageLabel: string;
    english: string;
    traditionalChinese: string;
    addToLine: string;
    logIn: string;
    motionOn: string;
    motionOff: string;
  };
  hero: {
    kicker: string;
    title: string;
    titleAccent: string;
    description: string;
    primaryCta: string;
    secondaryCta: string;
    loginCta: string;
    scroll: string;
  };
  scene: {
    group: string;
    monitor: string;
    vote: string;
    expense: string;
    confirmed: string;
  };
  metrics: Array<{ value: string; label: string }>;
  story: {
    eyebrow: string;
    heading: string;
    body: string;
    panels: Array<{ icon: "bot" | "vote" | "wallet"; title: string; text: string }>;
  };
  flow: {
    heading: string;
    items: Array<{ label: string; title: string; text: string }>;
  };
  commands: {
    heading: string;
    subheading: string;
    items: Array<{ cmd: string; desc: string; state: string }>;
  };
  cta: {
    heading: string;
    body: string;
    button: string;
  };
  footer: {
    madeFor: string;
    openApp: string;
  };
};

const LANGUAGE_STORAGE_KEY = "travelsync-home-locale";
const MOTION_STORAGE_KEY = "travelsync-home-force-motion";

const CONTENT = {
  en: {
    brand: "TravelSync AI",
    editionBadge: "Japan Ski",
    nav: {
      story: "Story",
      commands: "Commands",
      languageLabel: "Language",
      english: "EN",
      traditionalChinese: "繁中",
      addToLine: "Add to LINE",
      logIn: "Log in",
      motionOn: "Flow on",
      motionOff: "Flow",
    },
    hero: {
      kicker: "LINE-native trip planning",
      title: "Group travel,",
      titleAccent: "rendered from chat.",
      description:
        "Invite TravelSync AI into a LINE group and watch loose plans become a living trip board: ideas, votes, expenses, reminders, and confirmed decisions in one shared rhythm.",
      primaryCta: "Add to LINE",
      secondaryCta: "Enter the story",
      loginCta: "Open web app",
      scroll: "Scroll",
    },
    scene: {
      group: "Niseko crew",
      monitor: "AI monitor",
      vote: "Ryokan vote",
      expense: "Lift pass split",
      confirmed: "3 confirmed",
    },
    metrics: [
      { value: "LINE", label: "No app switching" },
      { value: "AI", label: "Chat becomes structure" },
      { value: "Live", label: "Everyone sees the same board" },
    ],
    story: {
      eyebrow: "The Next Trip",
      heading: "A cinematic control room for messy group plans.",
      body:
        "Travel plans usually disappear into chat history. TravelSync stages the same data as a living scene, so every idea, vote, and shared cost feels visible enough for the group to act on.",
      panels: [
        {
          icon: "bot",
          title: "Read the room",
          text: "TravelSync listens for destinations, dates, tasks, and money mentions as the group chats naturally.",
        },
        {
          icon: "vote",
          title: "Turn talk into decisions",
          text: "Any option can become a vote card, so the group moves from maybe to confirmed without leaving LINE.",
        },
        {
          icon: "wallet",
          title: "Keep the math calm",
          text: "Shared expenses land in the board as they happen, with settlement details waiting when the trip ends.",
        },
      ],
    },
    flow: {
      heading: "From message to motion",
      items: [
        {
          label: "01",
          title: "Invite",
          text: "Add TravelSync to the group where the trip already lives.",
        },
        {
          label: "02",
          title: "Discuss",
          text: "Hotels, trains, budgets, and deadlines are extracted from real conversation.",
        },
        {
          label: "03",
          title: "Decide",
          text: "Votes, reminders, and confirmations keep the plan moving.",
        },
      ],
    },
    commands: {
      heading: "Commands with a visible pulse",
      subheading: "Short LINE commands become durable trip objects.",
      items: [
        { cmd: "/start Niseko Jan 5-12", desc: "Create the shared trip", state: "new trip" },
        { cmd: "/vote hotel", desc: "Launch a visual vote", state: "pending" },
        { cmd: "/add book travel insurance", desc: "Capture a task", state: "todo" },
        { cmd: "/exp 3200 dinner for all", desc: "Split an expense", state: "settled" },
        { cmd: "/status", desc: "Show the current board", state: "live" },
        { cmd: "/nudge", desc: "Remind non-voters", state: "sent" },
      ],
    },
    cta: {
      heading: "Let the group chat keep its energy.",
      body:
        "TravelSync handles the structure underneath: votes, expenses, reminders, and the plan everyone can trust.",
      button: "Add TravelSync to LINE",
    },
    footer: {
      madeFor: "Built for travelers who plan together.",
      openApp: "Open App",
    },
  },
  "zh-TW": {
    brand: "TravelSync AI",
    editionBadge: "日本滑雪",
    nav: {
      story: "故事",
      commands: "指令",
      languageLabel: "語言",
      english: "EN",
      traditionalChinese: "繁中",
      addToLine: "加入 LINE",
      logIn: "登入",
      motionOn: "Flow on",
      motionOff: "Flow",
    },
    hero: {
      kicker: "專為 LINE 群組打造",
      title: "多人旅行，",
      titleAccent: "從聊天變成行動。",
      description:
        "把 TravelSync AI 加進 LINE 群組，零散的討論會變成即時旅行看板：靈感、投票、費用、提醒與已確認決策都在同一個節奏裡。",
      primaryCta: "加入 LINE",
      secondaryCta: "進入故事",
      loginCta: "開啟網頁版",
      scroll: "向下",
    },
    scene: {
      group: "二世谷揪團",
      monitor: "AI 監聽",
      vote: "旅館投票",
      expense: "雪票分帳",
      confirmed: "3 項已確認",
    },
    metrics: [
      { value: "LINE", label: "不用切換 App" },
      { value: "AI", label: "聊天自動變結構" },
      { value: "Live", label: "大家看到同一份看板" },
    ],
    story: {
      eyebrow: "The Next Trip",
      heading: "把混亂的群組討論變成電影感控制室。",
      body:
        "旅行計畫常常沉進聊天紀錄裡。TravelSync 把同樣的資料演出成即時場景，讓每個靈感、投票與共同支出都清楚到足以推動下一步。",
      panels: [
        {
          icon: "bot",
          title: "讀懂群組",
          text: "TravelSync 會從自然聊天裡抓出目的地、日期、待辦與費用線索。",
        },
        {
          icon: "vote",
          title: "讓討論變決策",
          text: "任何選項都能變成投票卡，讓大家不離開 LINE 就能完成確認。",
        },
        {
          icon: "wallet",
          title: "讓分帳安靜下來",
          text: "共同支出會即時進入看板，旅程結束時直接看到結算結果。",
        },
      ],
    },
    flow: {
      heading: "從訊息到行動",
      items: [
        {
          label: "01",
          title: "邀請",
          text: "把 TravelSync 加到原本討論旅行的 LINE 群組。",
        },
        {
          label: "02",
          title: "討論",
          text: "飯店、交通、預算與期限會從真實對話中整理出來。",
        },
        {
          label: "03",
          title: "決定",
          text: "投票、提醒與確認讓計畫自然往前走。",
        },
      ],
    },
    commands: {
      heading: "有節奏的 LINE 指令",
      subheading: "短短一行指令，就會變成可追蹤的旅行項目。",
      items: [
        { cmd: "/start Niseko Jan 5-12", desc: "建立共享旅程", state: "新旅程" },
        { cmd: "/vote hotel", desc: "發起視覺化投票", state: "投票中" },
        { cmd: "/add book travel insurance", desc: "新增待辦事項", state: "待辦" },
        { cmd: "/exp 3200 dinner for all", desc: "分攤共同支出", state: "已結算" },
        { cmd: "/status", desc: "顯示目前看板", state: "即時" },
        { cmd: "/nudge", desc: "提醒尚未投票成員", state: "已送出" },
      ],
    },
    cta: {
      heading: "保留群組聊天的熱度。",
      body:
        "TravelSync 在底層處理結構：投票、費用、提醒，以及每個人都能信任的最新計畫。",
      button: "加入 TravelSync 到 LINE",
    },
    footer: {
      madeFor: "為一起旅行的人打造。",
      openApp: "開啟 App",
    },
  },
} satisfies Record<Locale, Copy>;

function useTypewriter(text: string, forceMotion: boolean) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);

    const reduceMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplayed(text);
      setDone(true);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    let deleting = false;

    const tick = () => {
      if (!deleting) {
        i++;
        setDisplayed(text.slice(0, i));
        if (i < text.length) {
          timer = setTimeout(tick, 52);
        } else {
          setDone(true);
          // pause at full text, then start deleting
          timer = setTimeout(() => { deleting = true; tick(); }, 1800);
        }
      } else {
        i--;
        setDisplayed(text.slice(0, i));
        if (i > 0) {
          timer = setTimeout(tick, 32);
        } else {
          // pause at empty, then retype
          deleting = false;
          setDone(false);
          timer = setTimeout(tick, 600);
        }
      }
    };

    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [text, forceMotion]);

  return { displayed, done };
}

const iconMap = {
  bot: Bot,
  vote: Vote,
  wallet: CircleDollarSign,
};

export default function HomePageClient() {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [forceMotion, setForceMotion] = useState(false);
  const copy = CONTENT[locale];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (saved === "en" || saved === "zh-TW") {
        setLocale(saved);
      }

      setForceMotion(window.localStorage.getItem(MOTION_STORAGE_KEY) === "on");
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(MOTION_STORAGE_KEY, forceMotion ? "on" : "system");
  }, [forceMotion]);

  useIntroScrollMotion(locale, forceMotion);
  const { displayed: typedAccent, done: typewriterDone } = useTypewriter(copy.hero.titleAccent, forceMotion);

  return (
    <div className="min-h-screen bg-[#edf3f8] text-[#0e1822] selection:bg-[#00b900] selection:text-white dark:bg-[#0a121b] dark:text-[#e6eff5]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/10 bg-[#edf3f8]/76 backdrop-blur-xl dark:border-white/10 dark:bg-[#0a121b]/72">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={copy.brand}>
            <Image
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-[8px] object-contain"
              priority
            />
            <span className="truncate text-sm font-black uppercase tracking-[0.18em]">
              {copy.brand}
            </span>
            <span
              className="hidden shrink-0 rounded-full border border-[#00b900]/40 bg-[#00b900]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#007a00] dark:border-[#00b900]/50 dark:bg-[#00b900]/15 dark:text-[#7ee37e] sm:inline-flex"
              aria-label={copy.editionBadge}
            >
              {copy.editionBadge}
            </span>
          </Link>

          <nav className="flex items-center gap-2 text-sm">
            <a href="#story" className="hidden px-3 py-2 text-[#5b6873] transition hover:text-current md:inline-flex">
              {copy.nav.story}
            </a>
            <a href="#commands" className="hidden px-3 py-2 text-[#5b6873] transition hover:text-current md:inline-flex">
              {copy.nav.commands}
            </a>
            <div
              className="flex h-9 items-center rounded-[8px] border border-black/10 bg-white/50 p-1 dark:border-white/10 dark:bg-white/5"
              role="group"
              aria-label={copy.nav.languageLabel}
            >
              <Languages className="ml-1 hidden h-4 w-4 text-[#5b6873] sm:block" aria-hidden />
              <button
                type="button"
                onClick={() => setLocale("en")}
                aria-pressed={locale === "en"}
                className={`h-7 rounded-[6px] px-2.5 text-xs font-bold transition ${
                  locale === "en"
                    ? "bg-[#0e1822] text-white dark:bg-[#e6eff5] dark:text-[#0a121b]"
                    : "text-[#5b6873] hover:text-current"
                }`}
              >
                {copy.nav.english}
              </button>
              <button
                type="button"
                onClick={() => setLocale("zh-TW")}
                aria-pressed={locale === "zh-TW"}
                className={`h-7 rounded-[6px] px-2.5 text-xs font-bold transition ${
                  locale === "zh-TW"
                    ? "bg-[#0e1822] text-white dark:bg-[#e6eff5] dark:text-[#0a121b]"
                    : "text-[#5b6873] hover:text-current"
                }`}
              >
                {copy.nav.traditionalChinese}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setForceMotion((current) => !current)}
              aria-pressed={forceMotion}
              title={forceMotion ? copy.nav.motionOn : copy.nav.motionOff}
              className={`inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-sm font-black transition ${
                forceMotion
                  ? "border-[#00b900]/40 bg-[#00b900] text-white shadow-[0_12px_28px_-16px_rgba(0,185,0,0.7)]"
                  : "border-black/10 bg-white/45 text-[#5b6873] hover:bg-white/70 hover:text-current dark:border-white/10 dark:bg-white/5 dark:text-[#9caab9] dark:hover:bg-white/10"
              }`}
            >
              <Route className="h-4 w-4" aria-hidden />
              <span className="hidden lg:inline">{forceMotion ? copy.nav.motionOn : copy.nav.motionOff}</span>
            </button>
            <a
              href="#commands"
              className="hidden h-9 items-center gap-2 rounded-[8px] bg-[#00b900] px-3 text-sm font-black text-white shadow-[0_12px_28px_-16px_rgba(0,185,0,0.7)] transition hover:-translate-y-0.5 sm:inline-flex"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {copy.nav.addToLine}
            </a>
            <Link
              href="/app"
              className="inline-flex h-9 items-center rounded-[8px] border border-black/10 px-3 text-sm font-bold transition hover:bg-white/60 dark:border-white/10 dark:hover:bg-white/10"
            >
              {copy.nav.logIn}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative min-h-screen overflow-hidden pt-16">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(237,243,248,0.2)_0%,rgba(237,243,248,0.82)_76%,#edf3f8_100%)] dark:bg-[linear-gradient(180deg,rgba(10,18,27,0.08)_0%,rgba(10,18,27,0.72)_72%,#0a121b_100%)]" />
          <MountainSilhouette />
          <SnowflakeField />

          <div className="relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="max-w-3xl">
              <p
                className="mb-5 inline-flex items-center gap-2 rounded-[8px] border border-black/10 bg-white/56 px-3 py-2 text-xs font-black uppercase tracking-[0.22em] text-[#5b6873] backdrop-blur dark:border-white/10 dark:bg-white/8 dark:text-[#9caab9]"
                data-scroll-reveal="up"
              >
                <Snowflake className="h-4 w-4 text-[#4dadd6]" aria-hidden />
                {copy.hero.kicker}
              </p>
              <h1
                className="max-w-4xl text-[clamp(3.4rem,10vw,6.7rem)] font-black leading-[0.9] tracking-normal"
                aria-label={`${copy.hero.title} ${copy.hero.titleAccent}`}
              >
                <span className="block" aria-hidden>
                  {copy.hero.title.split(" ").map((word, i, arr) => (
                    <span
                      key={i}
                      className="hero-word text-gradient-aurora inline-block"
                      style={{ "--word-i": i } as CSSProperties}
                    >
                      {word}{i < arr.length - 1 ? " " : ""}
                    </span>
                  ))}
                </span>
                <span className="block text-[#00b900]" aria-hidden>
                  {typedAccent}
                  {!typewriterDone && <span className="hero-cursor" />}
                </span>
              </h1>
              <p
                className="mt-8 max-w-2xl text-lg leading-8 text-[#3f4a55] dark:text-[#b3c2cf]"
                data-scroll-reveal="up"
                style={{ "--reveal-delay": "160ms" } as CSSProperties}
              >
                {copy.hero.description}
              </p>
              <div
                className="mt-9 flex flex-col gap-3 sm:flex-row"
                data-scroll-reveal="up"
                style={{ "--reveal-delay": "240ms" } as CSSProperties}
              >
                <a
                  href="#commands"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-[#00b900] px-6 text-sm font-black text-white shadow-[0_22px_44px_-24px_rgba(0,185,0,0.8)] transition hover:-translate-y-0.5"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  {copy.hero.primaryCta}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
                <a
                  href="#story"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-black/10 bg-white/56 px-6 text-sm font-black backdrop-blur transition hover:bg-white/80 dark:border-white/10 dark:bg-white/8 dark:hover:bg-white/12"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                  {copy.hero.secondaryCta}
                </a>
                <Link
                  href="/app"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] border border-black/10 px-6 text-sm font-black transition hover:bg-white/40 dark:border-white/10 dark:hover:bg-white/10"
                >
                  <Globe2 className="h-4 w-4" aria-hidden />
                  {copy.hero.loginCta}
                </Link>
              </div>
            </div>

            <div data-scroll-parallax="0.18">
              <HeroScene copy={copy.scene} />
            </div>
          </div>

          <div className="relative mx-auto flex max-w-7xl flex-col gap-4 px-4 pb-10 sm:px-6 md:flex-row md:items-end md:justify-between">
            <div className="grid w-full gap-3 sm:grid-cols-3 md:max-w-2xl">
              {copy.metrics.map((metric, index) => (
                <div
                  key={metric.label}
                  className="rounded-[8px] border border-black/10 bg-white/50 p-4 backdrop-blur dark:border-white/10 dark:bg-white/8"
                  data-scroll-reveal="up"
                  style={{ "--reveal-delay": `${index * 80}ms` } as CSSProperties}
                >
                  <p className="text-xl font-black">{metric.value}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[#5b6873] dark:text-[#9caab9]">
                    {metric.label}
                  </p>
                </div>
              ))}
            </div>
            <a
              href="#story"
              className="inline-flex items-center gap-3 text-xs font-black uppercase tracking-[0.24em] text-[#5b6873] dark:text-[#9caab9]"
            >
              {copy.hero.scroll}
              <span className="grid h-10 w-10 place-items-center rounded-full border border-current/30">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </span>
            </a>
          </div>
        </section>

        <section id="story" className="relative border-y border-black/10 bg-[#0c1422] text-[#e6eff5] dark:border-white/10">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
            <div data-scroll-reveal="left">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#81d978]">
                {copy.story.eyebrow}
              </p>
              <h2 className="mt-5 max-w-2xl text-4xl font-black leading-none tracking-normal sm:text-6xl">
                {copy.story.heading}
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-[#d3c9b6]">
                {copy.story.body}
              </p>
            </div>
            <div className="grid gap-3" data-scroll-parallax="-0.07">
              {copy.story.panels.map((panel, index) => {
                const Icon = iconMap[panel.icon];
                return (
                  <article
                    key={panel.title}
                    className="group grid gap-5 rounded-[8px] border border-white/10 bg-white/[0.06] p-5 transition hover:-translate-y-1 hover:bg-white/[0.09] sm:grid-cols-[auto_1fr]"
                    data-scroll-reveal="right"
                    style={{ "--reveal-delay": `${index * 110}ms` } as CSSProperties}
                  >
                    <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-[#00b900] text-white shadow-[0_18px_40px_-24px_rgba(0,185,0,0.9)]">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-3">
                        <span className="font-mono text-xs text-[#81d978]">0{index + 1}</span>
                        <h3 className="text-lg font-black">{panel.title}</h3>
                      </div>
                      <p className="leading-7 text-[#d3c9b6]">{panel.text}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#edf3f8] px-4 py-20 dark:bg-[#0a121b] sm:px-6 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <h2 className="max-w-3xl text-4xl font-black leading-none tracking-normal sm:text-6xl" data-scroll-reveal="up">
              {copy.flow.heading}
            </h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-[8px] border border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10 lg:grid-cols-3">
              {copy.flow.items.map((item, index) => (
                <article
                  key={item.label}
                  className="bg-[#edf3f8] p-6 dark:bg-[#0a121b]"
                  data-scroll-reveal="up"
                  style={{ "--reveal-delay": `${index * 120}ms` } as CSSProperties}
                >
                  <p className="font-mono text-xs text-[#00b900]">{item.label}</p>
                  <h3 className="mt-8 text-3xl font-black">{item.title}</h3>
                  <p className="mt-4 leading-7 text-[#5b6873] dark:text-[#9caab9]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="commands" className="bg-[#d8e6f0] px-4 py-20 dark:bg-[#0c1422] sm:px-6 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.86fr_1.14fr]">
            <div data-scroll-reveal="left">
              <h2 className="text-4xl font-black leading-none tracking-normal sm:text-6xl">
                {copy.commands.heading}
              </h2>
              <p className="mt-5 max-w-md leading-8 text-[#5b6873] dark:text-[#9caab9]">
                {copy.commands.subheading}
              </p>
            </div>
            <div className="grid gap-3">
              {copy.commands.items.map((command, index) => (
                <CommandRow key={command.cmd} command={command} index={index} />
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#00b900] px-4 py-20 text-white sm:px-6 lg:py-28">
          <div className="absolute inset-x-0 top-0 h-px bg-white/40" />
          <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl" data-scroll-reveal="up">
              <h2 className="text-4xl font-black leading-none tracking-normal sm:text-7xl">
                {copy.cta.heading}
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/82">{copy.cta.body}</p>
            </div>
            <a
              href="#commands"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-[8px] bg-white px-7 text-sm font-black text-[#087a08] shadow-[0_28px_60px_-28px_rgba(0,0,0,0.45)] transition hover:-translate-y-0.5"
              data-scroll-reveal="right"
              style={{ "--reveal-delay": "120ms" } as CSSProperties}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {copy.cta.button}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/10 bg-[#edf3f8] px-4 py-8 dark:border-white/10 dark:bg-[#0a121b] sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-[#5b6873] dark:text-[#9caab9] sm:flex-row sm:items-center sm:justify-between">
          <p className="font-bold">{copy.footer.madeFor}</p>
          <nav className="flex items-center gap-4">
            <Link href="/app" className="font-bold transition hover:text-current">
              {copy.footer.openApp}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function IntroCanvas({ forceMotion }: { forceMotion: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.floor(rect.width);
      const nextHeight = Math.floor(rect.height);
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);

      if (nextWidth <= 0 || nextHeight <= 0) {
        return false;
      }

      if (
        width === nextWidth &&
        height === nextHeight &&
        dpr === nextDpr &&
        canvas.width === Math.floor(nextWidth * nextDpr) &&
        canvas.height === Math.floor(nextHeight * nextDpr)
      ) {
        return true;
      }

      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const draw = (time = 0) => {
      if (!resize()) {
        frame = window.requestAnimationFrame(draw);
        return;
      }

      context.clearRect(0, 0, width, height);

      const t = time * 0.00018;
      const flow = time * 0.00038;
      const horizon = height * 0.52;
      const vanishingX = width * (0.52 + Math.sin(t) * 0.04);

      const drawFlowDot = (x: number, y: number, radius: number, color: string) => {
        context.save();
        context.shadowBlur = radius * 5;
        context.shadowColor = color;
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.restore();
      };

      context.fillStyle = "rgba(0, 185, 0, 0.08)";
      for (let i = 0; i < 10; i += 1) {
        const y = horizon + i * i * 10;
        context.fillRect(0, y, width, 1);

        for (let packet = 0; packet < 2; packet += 1) {
          const p = (flow * 0.28 + i * 0.071 + packet * 0.48) % 1;
          const x = p * width;
          const trail = Math.max(28, width * 0.045);
          const gradient = context.createLinearGradient(x - trail, y, x + trail, y);
          gradient.addColorStop(0, "rgba(0, 185, 0, 0)");
          gradient.addColorStop(0.55, "rgba(0, 185, 0, 0.22)");
          gradient.addColorStop(1, "rgba(0, 185, 0, 0)");
          context.strokeStyle = gradient;
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(x - trail, y);
          context.lineTo(x + trail, y);
          context.stroke();
        }
      }

      for (let i = -8; i <= 8; i += 1) {
        const endX = width * 0.5 + i * width * 0.12;
        context.beginPath();
        context.moveTo(vanishingX, horizon);
        context.lineTo(endX, height);
        context.strokeStyle = i % 2 === 0 ? "rgba(0, 185, 0, 0.18)" : "rgba(22, 20, 15, 0.10)";
        context.lineWidth = 1;
        context.stroke();

        if (i % 2 === 0) {
          const head = (flow * 0.2 + (i + 8) * 0.047) % 1;
          const tail = Math.max(0, head - 0.09);
          const headEase = head * head;
          const tailEase = tail * tail;
          const headX = vanishingX + (endX - vanishingX) * headEase;
          const headY = horizon + (height - horizon) * headEase;
          const tailX = vanishingX + (endX - vanishingX) * tailEase;
          const tailY = horizon + (height - horizon) * tailEase;

          const gradient = context.createLinearGradient(tailX, tailY, headX, headY);
          gradient.addColorStop(0, "rgba(0, 185, 0, 0)");
          gradient.addColorStop(1, "rgba(0, 185, 0, 0.45)");
          context.strokeStyle = gradient;
          context.lineWidth = 1.5 + head * 1.5;
          context.beginPath();
          context.moveTo(tailX, tailY);
          context.lineTo(headX, headY);
          context.stroke();
          drawFlowDot(headX, headY, 1.8 + head * 2.4, "rgba(0, 185, 0, 0.82)");
        }
      }

      const ribbons = [
        { color: "rgba(0, 185, 0, 0.55)", flowColor: "rgba(0, 185, 0, 0.9)", offset: 0 },
        { color: "rgba(237, 111, 74, 0.42)", flowColor: "rgba(237, 111, 74, 0.72)", offset: 1.7 },
        { color: "rgba(36, 149, 169, 0.38)", flowColor: "rgba(36, 149, 169, 0.68)", offset: 3.1 },
      ];

      ribbons.forEach((ribbon, ribbonIndex) => {
        const getRibbonPoint = (p: number) => ({
          x: p * width,
          y:
            height * (0.18 + ribbonIndex * 0.14) +
            Math.sin(p * 8 + t * 16 + ribbon.offset) * 34 +
            Math.cos(p * 3 + ribbon.offset) * 28,
        });

        context.beginPath();
        for (let i = 0; i <= 90; i += 1) {
          const p = i / 90;
          const { x, y } = getRibbonPoint(p);
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = ribbon.color;
        context.lineWidth = ribbonIndex === 0 ? 3 : 2;
        context.stroke();

        for (let packet = 0; packet < 3; packet += 1) {
          const head = (flow * (0.26 + ribbonIndex * 0.035) + ribbonIndex * 0.14 + packet * 0.34) % 1;
          const tail = Math.max(0, head - 0.1);
          const headPoint = getRibbonPoint(head);
          const tailPoint = getRibbonPoint(tail);
          const gradient = context.createLinearGradient(tailPoint.x, tailPoint.y, headPoint.x, headPoint.y);
          gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
          gradient.addColorStop(0.72, ribbon.flowColor.replace("0.9", "0.28").replace("0.72", "0.24").replace("0.68", "0.22"));
          gradient.addColorStop(1, ribbon.flowColor);

          context.beginPath();
          for (let step = 0; step <= 16; step += 1) {
            const p = tail + (head - tail) * (step / 16);
            const point = getRibbonPoint(p);
            if (step === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          }
          context.strokeStyle = gradient;
          context.lineWidth = ribbonIndex === 0 ? 4 : 3;
          context.stroke();
          drawFlowDot(headPoint.x, headPoint.y, ribbonIndex === 0 ? 3.1 : 2.4, ribbon.flowColor);
        }
      });

      for (let i = 0; i < 28; i += 1) {
        const p = i / 28;
        const x = ((p + t * 0.06) % 1) * width;
        const y = height * (0.17 + ((i * 37) % 58) / 100);
        const pulse = 1 + Math.sin(t * 24 + i) * 0.35;
        context.beginPath();
        context.arc(x, y, 2.2 * pulse, 0, Math.PI * 2);
        context.fillStyle = i % 3 === 0 ? "rgba(0, 185, 0, 0.78)" : "rgba(22, 20, 15, 0.22)";
        context.fill();
      }

      if (!reducedMotion) {
        frame = window.requestAnimationFrame(draw);
      }
    };

    const observer = new ResizeObserver(() => {
      if (reducedMotion) {
        draw(performance.now());
      }
    });

    observer.observe(canvas);
    window.addEventListener("resize", resize);
    frame = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(frame);
    };
  }, [forceMotion]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-80" aria-hidden />;
}

function useIntroScrollMotion(locale: Locale, forceMotion: boolean) {
  useEffect(() => {
    const reduceMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealElements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    const parallaxElements = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-parallax]"));

    if (reduceMotion) {
      document.documentElement.classList.remove("scroll-reveal-ready");
      revealElements.forEach((element) => {
        element.dataset.inview = "true";
      });
      return;
    }

    document.documentElement.classList.add("scroll-reveal-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const element = entry.target as HTMLElement;
          element.dataset.inview = "true";
          observer.unobserve(element);
        });
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.16,
      },
    );

    revealElements.forEach((element) => {
      element.dataset.inview = "false";
      observer.observe(element);
    });

    let frame = 0;
    const updateParallax = () => {
      frame = 0;
      const viewportHeight = window.innerHeight || 1;

      parallaxElements.forEach((element) => {
        const speed = Number(element.dataset.scrollParallax ?? 0.12);
        const rect = element.getBoundingClientRect();
        const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height) - 0.5;
        const shift = Math.max(-42, Math.min(42, progress * speed * 180));

        element.style.setProperty("--scroll-shift", `${shift.toFixed(2)}px`);
        element.style.setProperty("--scroll-tilt", `${(shift * 0.035).toFixed(2)}deg`);
      });
    };

    const queueParallax = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateParallax);
    };

    updateParallax();
    window.addEventListener("scroll", queueParallax, { passive: true });
    window.addEventListener("resize", queueParallax);

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("scroll-reveal-ready");
      window.removeEventListener("scroll", queueParallax);
      window.removeEventListener("resize", queueParallax);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [locale, forceMotion]);
}

function HeroScene({ copy }: { copy: Copy["scene"] }) {
  return (
    <div className="relative mx-auto aspect-[0.82] w-full max-w-[500px] min-w-0 [perspective:1200px]">
      <div className="absolute inset-[7%] rotate-[-5deg] rounded-[8px] border border-black/10 bg-[#0e1822] shadow-[0_50px_90px_-42px_rgba(14,24,34,0.75)] [transform-style:preserve-3d] dark:border-white/10">
        <div className="absolute inset-0 rounded-[8px] bg-[linear-gradient(135deg,#0d1822_0%,#1a2630_42%,#0a3142_100%)]" />
        <div className="absolute inset-4 rounded-[8px] border border-white/10 bg-black/18" />

        <SceneChip className="left-[8%] top-[8%]" icon={<Users className="h-4 w-4" />} label={copy.group} />
        <SceneChip className="right-[8%] top-[21%]" icon={<Bot className="h-4 w-4" />} label={copy.monitor} />
        <SceneChip className="left-[10%] bottom-[26%]" icon={<Vote className="h-4 w-4" />} label={copy.vote} />
        <SceneChip className="right-[7%] bottom-[12%]" icon={<CircleDollarSign className="h-4 w-4" />} label={copy.expense} />

        <div className="absolute left-[18%] top-[34%] w-[64%] rounded-[8px] border border-white/10 bg-white/10 p-4 text-white shadow-[0_22px_70px_-24px_rgba(0,0,0,0.8)] backdrop-blur [transform:translateZ(64px)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#81d978]">Trip Board</p>
              <p className="mt-1 text-2xl font-black">Niseko</p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-[8px] bg-[#00b900]">
              <MountainSnow className="h-5 w-5" aria-hidden />
            </div>
          </div>
          <div className="space-y-2">
            <SceneRow icon={<CalendarCheck className="h-4 w-4" />} label="Jan 5-12" done />
            <SceneRow icon={<Vote className="h-4 w-4" />} label={copy.vote} />
            <SceneRow icon={<CircleDollarSign className="h-4 w-4" />} label={copy.expense} done />
          </div>
        </div>

        <div className="absolute bottom-[8%] left-[28%] flex items-center gap-2 rounded-[8px] bg-[#00b900] px-4 py-3 text-sm font-black text-white shadow-[0_18px_40px_-18px_rgba(0,185,0,0.9)] [transform:translateZ(86px)]">
          <Check className="h-4 w-4" aria-hidden />
          {copy.confirmed}
        </div>
      </div>
    </div>
  );
}

function SceneChip({
  icon,
  label,
  className,
}: {
  icon: ReactNode;
  label: string;
  className: string;
}) {
  return (
    <div
      className={`absolute flex items-center gap-2 rounded-[8px] border border-white/10 bg-white/12 px-3 py-2 text-xs font-black text-white shadow-[0_16px_44px_-24px_rgba(0,0,0,0.8)] backdrop-blur [transform:translateZ(44px)] ${className}`}
    >
      <span className="text-[#81d978]">{icon}</span>
      {label}
    </div>
  );
}

function SceneRow({ icon, label, done = false }: { icon: ReactNode; label: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] bg-black/24 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className={done ? "text-[#81d978]" : "text-[#efb663]"}>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      {done ? <Check className="h-4 w-4 text-[#81d978]" aria-hidden /> : <span className="h-2 w-2 rounded-full bg-[#efb663]" />}
    </div>
  );
}

function CommandRow({ command, index }: { command: Copy["commands"]["items"][number]; index: number }) {
  return (
    <article
      className="grid gap-4 rounded-[8px] border border-black/10 bg-[#edf3f8] p-4 shadow-[0_14px_32px_-28px_rgba(14,24,34,0.55)] transition hover:-translate-y-1 hover:bg-white/70 dark:border-white/10 dark:bg-[#0a121b] dark:hover:bg-white/[0.06] sm:grid-cols-[1fr_auto] sm:items-center"
      data-scroll-reveal="up"
      style={{ "--reveal-delay": `${index * 70}ms` } as CSSProperties}
    >
      <div className="min-w-0">
        <code className="block truncate font-mono text-sm font-black text-[#0e1822] dark:text-[#e6eff5]">
          {command.cmd}
        </code>
        <p className="mt-1 text-sm text-[#5b6873] dark:text-[#9caab9]">{command.desc}</p>
      </div>
      <span className="inline-flex w-fit items-center gap-2 rounded-[8px] border border-[#00b900]/30 bg-[#00b900]/10 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#087a08] dark:text-[#81d978]">
        <span className="h-2 w-2 rounded-full bg-[#00b900]" />
        {command.state}
      </span>
    </article>
  );
}

// Decorative mountain silhouette anchored to the bottom of the hero. Purely
// visual — sits behind the gradient overlay and above IntroCanvas at low
// opacity so it doesn't fight the foreground text.
function MountainSilhouette() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] w-full text-[#cbd9e6] opacity-70 dark:text-[#101e2d] dark:opacity-90"
      viewBox="0 0 1440 480"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="ridge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d="M0 360 L160 240 L260 300 L380 160 L520 280 L640 200 L760 320 L880 180 L1020 260 L1160 140 L1280 280 L1440 220 L1440 480 L0 480 Z"
        fill="url(#ridge)"
      />
      <path
        d="M0 420 L120 340 L240 400 L360 320 L480 380 L600 340 L720 400 L840 320 L960 380 L1080 340 L1200 400 L1320 340 L1440 380 L1440 480 L0 480 Z"
        fill="currentColor"
        opacity="0.55"
      />
      {/* Snow caps on the highest peaks */}
      <path d="M360 160 L390 190 L380 195 L370 188 L355 197 L348 188 Z" fill="#ffffff" opacity="0.85" />
      <path d="M880 180 L908 208 L898 213 L886 205 L874 215 L866 205 Z" fill="#ffffff" opacity="0.85" />
      <path d="M1160 140 L1192 174 L1182 178 L1170 168 L1156 178 L1148 168 Z" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

// Sparse, fixed-position snowflakes. Deliberately small in count to read as
// atmospheric rather than busy; no animation to keep the page light.
function SnowflakeField() {
  const positions = [
    { top: "12%", left: "8%",  size: 14, op: 0.55 },
    { top: "22%", left: "78%", size: 10, op: 0.45 },
    { top: "34%", left: "18%", size: 8,  op: 0.40 },
    { top: "44%", left: "62%", size: 12, op: 0.50 },
    { top: "58%", left: "30%", size: 9,  op: 0.40 },
    { top: "16%", left: "44%", size: 7,  op: 0.35 },
    { top: "70%", left: "85%", size: 11, op: 0.45 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {positions.map((p, i) => (
        <Snowflake
          key={i}
          className="absolute text-[#7eb6d3] dark:text-[#5e8aa6]"
          style={{ top: p.top, left: p.left, width: p.size, height: p.size, opacity: p.op }}
        />
      ))}
    </div>
  );
}
