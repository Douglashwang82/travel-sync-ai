'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Globe2, Languages, MessageCircle, Sparkles } from "lucide-react";
import PlanScene from "./plan-scene";

type Locale = "en" | "zh-TW";

type Copy = {
  brand: string;
  editionBadge: string;
  nav: {
    work: string;
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
    intents: string[];
    title: string;
    titleAccent: string;
    description: string;
    primaryCta: string;
    loginCta: string;
  };
  metrics: Array<{ value: string; label: string }>;
  statement: {
    eyebrow: string;
    heading: string;
    body: string;
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
    editionBadge: "Group travel",
    nav: {
      work: "How it works",
      commands: "Commands",
      languageLabel: "Language",
      english: "EN",
      traditionalChinese: "繁中",
      addToLine: "Add to LINE",
      logIn: "Log in",
      motionOn: "Motion on",
      motionOff: "Motion",
    },
    hero: {
      intents: [
        "Planning a group trip?",
        "Five friends, one budget?",
        "Tired of losing plans in the chat?",
        "Ready to turn maybes into a plan?",
      ],
      title: "Group travel,",
      titleAccent: "sorted in chat.",
      description:
        "Add TravelSync to your LINE group and the conversation becomes the plan — ideas, votes, expenses, and reminders organized as you talk. No new app to learn.",
      primaryCta: "Add to LINE",
      loginCta: "Open web app",
    },
    metrics: [
      { value: "In LINE", label: "No app switching" },
      { value: "From chat", label: "Talk becomes structure" },
      { value: "In sync", label: "One board for everyone" },
    ],
    statement: {
      eyebrow: "The idea",
      heading: "Your group already made the plan. It's just buried in the chat.",
      body:
        "TravelSync reads the conversation you're already having and quietly turns it into a living trip — so the decisions you reached together don't scroll away.",
    },
    flow: {
      heading: "Three steps. That's the whole thing.",
      items: [
        { label: "01", title: "Invite", text: "Add TravelSync to the group where the trip already lives." },
        { label: "02", title: "Discuss", text: "Hotels, trains, budgets, and deadlines are pulled from real conversation." },
        { label: "03", title: "Decide", text: "Votes, reminders, and confirmations keep the plan moving forward." },
      ],
    },
    commands: {
      heading: "A few words. A real plan.",
      subheading: "Short LINE commands become durable trip objects everyone can see.",
      items: [
        { cmd: "/start Tokyo Mar 5-12", desc: "Create the shared trip", state: "new trip" },
        { cmd: "/vote hotel", desc: "Launch a visual vote", state: "pending" },
        { cmd: "/add book travel insurance", desc: "Capture a task", state: "todo" },
        { cmd: "/exp 3200 dinner for all", desc: "Split an expense", state: "settled" },
        { cmd: "/status", desc: "Show the current board", state: "live" },
        { cmd: "/nudge", desc: "Remind non-voters", state: "sent" },
      ],
    },
    cta: {
      heading: "Let the group keep its energy.",
      body: "TravelSync handles the structure underneath — votes, expenses, reminders, and a plan everyone can trust.",
      button: "Add TravelSync to LINE",
    },
    footer: {
      madeFor: "Built for travelers who plan together.",
      openApp: "Open App",
    },
  },
  "zh-TW": {
    brand: "TravelSync AI",
    editionBadge: "多人旅行",
    nav: {
      work: "運作方式",
      commands: "指令",
      languageLabel: "語言",
      english: "EN",
      traditionalChinese: "繁中",
      addToLine: "加入 LINE",
      logIn: "登入",
      motionOn: "動態開",
      motionOff: "動態",
    },
    hero: {
      intents: [
        "正在揪團出去玩？",
        "五個朋友、一筆預算？",
        "計畫總是淹沒在聊天紀錄裡？",
        "想把「再說」變成真正的計畫？",
      ],
      title: "多人旅行，",
      titleAccent: "在聊天裡搞定。",
      description:
        "把 TravelSync 加進 LINE 群組，對話就會變成計畫——靈感、投票、費用與提醒會邊聊邊整理好。不用再學一個新 App。",
      primaryCta: "加入 LINE",
      loginCta: "開啟網頁版",
    },
    metrics: [
      { value: "在 LINE", label: "不用切換 App" },
      { value: "從聊天", label: "對話變成結構" },
      { value: "同步", label: "大家看同一份看板" },
    ],
    statement: {
      eyebrow: "核心想法",
      heading: "你們其實早就決定好了，只是埋在聊天紀錄裡。",
      body:
        "TravelSync 會讀懂你們正在進行的對話，悄悄把它整理成一趟活生生的旅程——讓一起做出的決定不會被洗掉。",
    },
    flow: {
      heading: "三個步驟，就這樣。",
      items: [
        { label: "01", title: "邀請", text: "把 TravelSync 加到原本討論旅行的 LINE 群組。" },
        { label: "02", title: "討論", text: "飯店、交通、預算與期限會從真實對話中整理出來。" },
        { label: "03", title: "決定", text: "投票、提醒與確認讓計畫自然往前走。" },
      ],
    },
    commands: {
      heading: "幾個字，一份真計畫。",
      subheading: "短短一行 LINE 指令，就會變成大家都看得到的旅行項目。",
      items: [
        { cmd: "/start Tokyo Mar 5-12", desc: "建立共享旅程", state: "新旅程" },
        { cmd: "/vote hotel", desc: "發起視覺化投票", state: "投票中" },
        { cmd: "/add book travel insurance", desc: "新增待辦事項", state: "待辦" },
        { cmd: "/exp 3200 dinner for all", desc: "分攤共同支出", state: "已結算" },
        { cmd: "/status", desc: "顯示目前看板", state: "即時" },
        { cmd: "/nudge", desc: "提醒尚未投票成員", state: "已送出" },
      ],
    },
    cta: {
      heading: "保留群組聊天的熱度。",
      body: "TravelSync 在底層處理結構：投票、費用、提醒，以及每個人都能信任的最新計畫。",
      button: "加入 TravelSync 到 LINE",
    },
    footer: {
      madeFor: "為一起旅行的人打造。",
      openApp: "開啟 App",
    },
  },
} satisfies Record<Locale, Copy>;

function useRotatingIndex(length: number, forceMotion: boolean, intervalMs = 3200) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (length <= 1) return;
    const reduceMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((current) => (current + 1) % length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [length, forceMotion, intervalMs]);

  return index;
}

// The single primary action. Springs toward the cursor within a small radius
// then eases home — tactile feedback on the one pixel that matters most.
function MagneticButton({
  href,
  forceMotion,
  className,
  children,
}: {
  href: string;
  forceMotion: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLAnchorElement>) => {
      const el = ref.current;
      if (!el || event.pointerType === "touch") return;
      const reduceMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) return;
      const rect = el.getBoundingClientRect();
      const mx = (event.clientX - rect.left - rect.width / 2) * 0.3;
      const my = (event.clientY - rect.top - rect.height / 2) * 0.4;
      el.style.setProperty("--mag-x", `${mx.toFixed(1)}px`);
      el.style.setProperty("--mag-y", `${my.toFixed(1)}px`);
    },
    [forceMotion],
  );

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--mag-x", "0px");
    el.style.setProperty("--mag-y", "0px");
  }, []);

  return (
    <a ref={ref} href={href} onPointerMove={onPointerMove} onPointerLeave={reset} className={`btn-magnetic ${className ?? ""}`}>
      {children}
    </a>
  );
}

export default function HomePageClient() {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [forceMotion, setForceMotion] = useState(false);
  const copy = CONTENT[locale];

  // Reads from localStorage after hydration to sync persisted user prefs.
  // Calling setState here is intentional (avoids SSR/client mismatch).
  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "zh-TW") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocale(saved);
    }
    setForceMotion(window.localStorage.getItem(MOTION_STORAGE_KEY) === "on");
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(MOTION_STORAGE_KEY, forceMotion ? "on" : "system");
  }, [forceMotion]);

  useScrollReveal(locale, forceMotion);
  const intentIndex = useRotatingIndex(copy.hero.intents.length, forceMotion);

  return (
    <div className="min-h-screen bg-[#f6f7f5] text-[#0b0d0c] antialiased selection:bg-[#00b900] selection:text-white dark:bg-[#08090b] dark:text-[#eef2f0]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/[0.06] bg-[#f6f7f5]/70 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#08090b]/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label={copy.brand}>
            <Image src="/logo.png" alt="" width={30} height={30} className="h-7 w-7 rounded-[7px] object-contain" priority />
            <span className="truncate text-[13px] font-bold tracking-[0.14em] uppercase">{copy.brand}</span>
          </Link>

          <nav className="flex items-center gap-1.5 text-sm">
            <a href="#work" className="hidden rounded-full px-3 py-2 text-[13px] text-[#5b6360] transition hover:text-current md:inline-flex dark:text-[#8b938f]">
              {copy.nav.work}
            </a>
            <a href="#commands" className="hidden rounded-full px-3 py-2 text-[13px] text-[#5b6360] transition hover:text-current md:inline-flex dark:text-[#8b938f]">
              {copy.nav.commands}
            </a>

            <div
              className="ml-1 flex h-8 items-center rounded-full border border-black/[0.08] bg-white/60 p-0.5 dark:border-white/[0.08] dark:bg-white/[0.04]"
              role="group"
              aria-label={copy.nav.languageLabel}
            >
              <Languages className="ml-1.5 hidden h-3.5 w-3.5 text-[#5b6360] sm:block dark:text-[#8b938f]" aria-hidden />
              <LangButton active={locale === "en"} onClick={() => setLocale("en")} label={copy.nav.english} />
              <LangButton active={locale === "zh-TW"} onClick={() => setLocale("zh-TW")} label={copy.nav.traditionalChinese} />
            </div>

            <button
              type="button"
              onClick={() => setForceMotion((current) => !current)}
              aria-pressed={forceMotion}
              title={forceMotion ? copy.nav.motionOn : copy.nav.motionOff}
              className={`hidden h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition sm:inline-flex ${
                forceMotion
                  ? "border-[#00b900]/30 bg-[#00b900]/10 text-[#0a7d0a] dark:text-[#5fe06a]"
                  : "border-black/[0.08] text-[#5b6360] hover:text-current dark:border-white/[0.08] dark:text-[#8b938f]"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {forceMotion ? copy.nav.motionOn : copy.nav.motionOff}
            </button>

            <Link
              href="/app"
              className="ml-0.5 inline-flex h-8 items-center rounded-full px-3 text-[13px] font-semibold text-[#5b6360] transition hover:text-current dark:text-[#8b938f]"
            >
              {copy.nav.logIn}
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ─── Hero: editorial minimalism + interactive globe ─────────────── */}
        <section className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-5 pt-28 pb-16 sm:px-8 lg:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
            <div className="relative z-10 max-w-2xl">
              <p
                className="mb-7 inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.04em] text-[#5b6360] dark:text-[#8b938f]"
                data-reveal
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#00b900]/12 text-[#00b900]">
                  <Sparkles className="h-3 w-3" aria-hidden />
                </span>
                <span key={intentIndex} className="intent-swap">
                  {copy.hero.intents[intentIndex]}
                </span>
              </p>

              <h1
                className="text-[clamp(2.9rem,8.4vw,5.6rem)] font-semibold leading-[0.96] tracking-[-0.035em] [font-family:var(--font-display)]"
                aria-label={`${copy.hero.title} ${copy.hero.titleAccent}`}
                data-reveal
                style={{ "--reveal-delay": "60ms" } as CSSProperties}
              >
                <span className="block">{copy.hero.title}</span>
                <span className="block text-[#00b900]">{copy.hero.titleAccent}</span>
              </h1>

              <p
                className="mt-7 max-w-lg text-[17px] leading-8 text-[#454c49] dark:text-[#a9b1ad]"
                data-reveal
                style={{ "--reveal-delay": "140ms" } as CSSProperties}
              >
                {copy.hero.description}
              </p>

              <div
                className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center"
                data-reveal
                style={{ "--reveal-delay": "220ms" } as CSSProperties}
              >
                <MagneticButton
                  href="#commands"
                  forceMotion={forceMotion}
                  className="group inline-flex h-13 items-center justify-center gap-2.5 rounded-full bg-[#00b900] px-7 text-[15px] font-semibold text-white shadow-[0_20px_46px_-20px_rgba(0,185,0,0.85)]"
                >
                  <MessageCircle className="h-[18px] w-[18px]" aria-hidden />
                  {copy.hero.primaryCta}
                  <ArrowRight className="h-[18px] w-[18px] transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                </MagneticButton>
                <Link
                  href="/app"
                  className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#5b6360] underline-offset-4 transition hover:text-current hover:underline dark:text-[#8b938f]"
                >
                  <Globe2 className="h-4 w-4" aria-hidden />
                  {copy.hero.loginCta}
                </Link>
              </div>
            </div>

            <div className="relative" data-reveal style={{ "--reveal-delay": "120ms" } as CSSProperties}>
              <PlanScene forceMotion={forceMotion} />
            </div>
          </div>

          {/* Quiet metric strip — anchors the fold without competing for the eye. */}
          <div className="mt-14 grid gap-x-10 gap-y-6 border-t border-black/[0.07] pt-8 sm:grid-cols-3 dark:border-white/[0.07]" data-reveal style={{ "--reveal-delay": "300ms" } as CSSProperties}>
            {copy.metrics.map((metric) => (
              <div key={metric.label}>
                <p className="text-lg font-semibold tracking-tight">{metric.value}</p>
                <p className="mt-1 text-[13px] text-[#5b6360] dark:text-[#8b938f]">{metric.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── Statement: one big editorial line ──────────────────────────── */}
        <section className="border-t border-black/[0.07] dark:border-white/[0.07]">
          <div className="mx-auto max-w-5xl px-5 py-28 sm:px-8 lg:py-36">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-[#00b900] uppercase" data-reveal>
              {copy.statement.eyebrow}
            </p>
            <h2
              className="mt-7 max-w-4xl text-[clamp(1.9rem,4.6vw,3.4rem)] font-semibold leading-[1.08] tracking-[-0.03em] [font-family:var(--font-display)]"
              data-reveal
              style={{ "--reveal-delay": "80ms" } as CSSProperties}
            >
              {copy.statement.heading}
            </h2>
            <p
              className="mt-7 max-w-xl text-[17px] leading-8 text-[#454c49] dark:text-[#a9b1ad]"
              data-reveal
              style={{ "--reveal-delay": "160ms" } as CSSProperties}
            >
              {copy.statement.body}
            </p>
          </div>
        </section>

        {/* ─── How it works ───────────────────────────────────────────────── */}
        <section id="work" className="border-t border-black/[0.07] dark:border-white/[0.07]">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
            <h2
              className="max-w-2xl text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] [font-family:var(--font-display)]"
              data-reveal
            >
              {copy.flow.heading}
            </h2>
            <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-3">
              {copy.flow.items.map((item, index) => (
                <article key={item.label} data-reveal style={{ "--reveal-delay": `${index * 90}ms` } as CSSProperties}>
                  <p className="text-mono text-[13px] text-[#00b900]">{item.label}</p>
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight">{item.title}</h3>
                  <p className="mt-3 leading-7 text-[#5b6360] dark:text-[#8b938f]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Commands ───────────────────────────────────────────────────── */}
        <section id="commands" className="border-t border-black/[0.07] dark:border-white/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:py-32">
            <div data-reveal>
              <h2 className="text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] [font-family:var(--font-display)]">
                {copy.commands.heading}
              </h2>
              <p className="mt-5 max-w-sm leading-8 text-[#5b6360] dark:text-[#8b938f]">{copy.commands.subheading}</p>
            </div>
            <ul className="divide-y divide-black/[0.07] border-y border-black/[0.07] dark:divide-white/[0.07] dark:border-white/[0.07]">
              {copy.commands.items.map((command, index) => (
                <CommandRow key={command.cmd} command={command} index={index} />
              ))}
            </ul>
          </div>
        </section>

        {/* ─── Final CTA ──────────────────────────────────────────────────── */}
        <section className="border-t border-black/[0.07] dark:border-white/[0.07]">
          <div className="mx-auto flex max-w-5xl flex-col items-center px-5 py-28 text-center sm:px-8 lg:py-40">
            <h2
              className="max-w-3xl text-[clamp(2.2rem,5.4vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em] [font-family:var(--font-display)]"
              data-reveal
            >
              {copy.cta.heading}
            </h2>
            <p
              className="mt-6 max-w-lg text-[17px] leading-8 text-[#454c49] dark:text-[#a9b1ad]"
              data-reveal
              style={{ "--reveal-delay": "80ms" } as CSSProperties}
            >
              {copy.cta.body}
            </p>
            <div className="mt-10" data-reveal style={{ "--reveal-delay": "160ms" } as CSSProperties}>
              <MagneticButton
                href="https://line.me"
                forceMotion={forceMotion}
                className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-[#00b900] px-8 text-base font-semibold text-white shadow-[0_24px_56px_-22px_rgba(0,185,0,0.9)]"
              >
                <MessageCircle className="h-5 w-5" aria-hidden />
                {copy.cta.button}
                <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
              </MagneticButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.07] dark:border-white/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-[#5b6360] sm:flex-row sm:items-center sm:justify-between sm:px-8 dark:text-[#8b938f]">
          <p>{copy.footer.madeFor}</p>
          <Link href="/app" className="font-semibold transition hover:text-current">
            {copy.footer.openApp}
          </Link>
        </div>
      </footer>
    </div>
  );
}

function LangButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 rounded-full px-2.5 text-[12px] font-bold transition ${
        active ? "bg-[#0b0d0c] text-white dark:bg-[#eef2f0] dark:text-[#08090b]" : "text-[#5b6360] hover:text-current dark:text-[#8b938f]"
      }`}
    >
      {label}
    </button>
  );
}

function CommandRow({ command, index }: { command: Copy["commands"]["items"][number]; index: number }) {
  return (
    <li
      className="group flex items-center justify-between gap-4 py-4 transition"
      data-reveal
      style={{ "--reveal-delay": `${index * 50}ms` } as CSSProperties}
    >
      <div className="min-w-0">
        <code className="block truncate text-mono text-[15px] font-semibold transition group-hover:text-[#00b900]">{command.cmd}</code>
        <p className="mt-0.5 text-[13px] text-[#5b6360] dark:text-[#8b938f]">{command.desc}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[#5b6360] dark:text-[#8b938f]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#00b900] transition group-hover:shadow-[0_0_0_4px_rgba(0,185,0,0.18)]" />
        {command.state}
      </span>
    </li>
  );
}

// Scroll-reveal choreography. Elements opt in with `data-reveal`; reduced-motion
// shows everything immediately.
function useScrollReveal(locale: Locale, forceMotion: boolean) {
  useEffect(() => {
    const reduceMotion = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (reduceMotion) {
      document.documentElement.classList.remove("reveal-ready");
      elements.forEach((el) => {
        el.dataset.inview = "true";
      });
      return;
    }

    document.documentElement.classList.add("reveal-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.inview = "true";
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );

    elements.forEach((el) => {
      el.dataset.inview = "false";
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, [locale, forceMotion]);
}
