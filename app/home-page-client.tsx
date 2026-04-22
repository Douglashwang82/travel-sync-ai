'use client'

import { useEffect, useState } from "react";
import Link from "next/link";

type Locale = "en" | "zh-TW";

const LANGUAGE_STORAGE_KEY = "travelsync-home-locale";

const CONTENT = {
  en: {
    brand: "TravelSync AI",
    nav: {
      features: "Features",
      howItWorks: "How it works",
      addToLine: "Add to LINE",
      languageLabel: "Language",
      english: "EN",
      traditionalChinese: "繁中",
    },
    hero: {
      badge: "Built for LINE groups",
      titleStart: "Plan group trips,",
      titleHighlight: "not group chats.",
      description:
        "TravelSync AI reads your LINE group chat, turns scattered conversations into an organized trip board, and helps your group make decisions - all without leaving LINE.",
      primaryCta: "Add to LINE",
      secondaryCta: "See how it works",
    },
    chat: {
      alice: "Anyone know a good hotel near Namba? 🏨",
      travelsyncAdded:
        'Got it! I\'ve added "Hotel near Namba" to the trip board. Type ',
      travelsyncAddedSuffix: " to start comparing options.",
      bob: "I paid Yen 8,400 for dinner last night",
      travelsyncExpense:
        "Logged! Dinner Yen 8,400 split 4 ways (Yen 2,100 each). Check the expense board for the full summary.",
    },
    stats: [
      { value: "LINE-native", label: "No extra apps" },
      { value: "AI-powered", label: "Auto-parses chats" },
      { value: "Free", label: "Always" },
    ],
    features: {
      heading: "Everything your group needs",
      subheading: "From idea to itinerary, without switching apps.",
      items: [
        {
          emoji: "🤖",
          title: "AI Message Parsing",
          desc: "TravelSync reads your group chat and automatically extracts destinations, dates, and preferences - no forms, no friction.",
        },
        {
          emoji: "🗳️",
          title: "Visual Group Voting",
          desc: "Start a vote on any trip item. Members vote on rich Flex Message cards with photos, ratings, and prices right inside LINE.",
        },
        {
          emoji: "💰",
          title: "Expense Splitting",
          desc: "Log shared costs as you go. TravelSync calculates who owes whom and shows the minimum number of transfers to settle up.",
        },
        {
          emoji: "📋",
          title: "Shared Trip Board",
          desc: "Every decision lives on a Kanban board - To-Do, Pending vote, Confirmed. Everyone in the group sees the same picture.",
        },
      ],
    },
    steps: {
      heading: "Up and running in 3 steps",
      items: [
        {
          n: "1",
          title: "Add TravelSync to your LINE group",
          desc: "Search for @travelsync in LINE and add it to any group chat.",
        },
        {
          n: "2",
          title: "Chat about your trip naturally",
          desc: 'Just talk. Mention "Let\'s stay at a hotel near Shinjuku" and TravelSync adds it to the board.',
        },
        {
          n: "3",
          title: "Vote, confirm, and go",
          desc: "Run /vote on any item. Members vote directly in chat. Winner gets confirmed automatically.",
        },
      ],
    },
    commands: {
      heading: "Simple slash commands",
      subheading: "Type these in your LINE group to get started.",
      items: [
        { cmd: "/start Osaka Jul 15-20", desc: "Create a new trip" },
        { cmd: "/vote hotel", desc: "Start a visual vote" },
        { cmd: "/add book travel insurance", desc: "Add a to-do item" },
        { cmd: "/exp 3200 dinner for all", desc: "Log a shared expense" },
        { cmd: "/status", desc: "Show the trip board" },
        { cmd: "/nudge", desc: "Remind non-voters" },
      ],
    },
    cta: {
      heading: "Start planning smarter.",
      description:
        "Add TravelSync AI to your LINE group and let the bot handle the chaos while you focus on the fun.",
      button: "Add TravelSync to LINE ->",
    },
    footer: {
      copyright: "© 2026 TravelSync AI. Built for travelers.",
      help: "Help",
      openApp: "Open App",
    },
  },
  "zh-TW": {
    brand: "TravelSync AI",
    nav: {
      features: "功能特色",
      howItWorks: "使用方式",
      addToLine: "加入 LINE",
      languageLabel: "語言",
      english: "EN",
      traditionalChinese: "繁中",
    },
    hero: {
      badge: "專為 LINE 群組打造",
      titleStart: "規劃多人旅行，",
      titleHighlight: "不用再刷群組訊息。",
      description:
        "TravelSync AI 會讀取你的 LINE 群組對話，把零散的討論整理成清楚的旅行看板，幫助整個團隊做決定，全程不用離開 LINE。",
      primaryCta: "加入 LINE",
      secondaryCta: "看看怎麼運作",
    },
    chat: {
      alice: "有人知道難波附近不錯的飯店嗎？🏨",
      travelsyncAdded: "收到！我已經把「難波附近飯店」加入旅行看板。輸入 ",
      travelsyncAddedSuffix: " 就能開始比較選項。",
      bob: "昨天晚餐我先付了 8,400 日圓",
      travelsyncExpense:
        "已記錄！晚餐 8,400 日圓，4 人分攤（每人 2,100 日圓）。可到費用看板查看完整摘要。",
    },
    stats: [
      { value: "LINE 原生", label: "不用額外安裝 App" },
      { value: "AI 驅動", label: "自動整理聊天內容" },
      { value: "免費", label: "一直都是" },
    ],
    features: {
      heading: "群組旅行需要的功能一次到位",
      subheading: "從發想到行程確認，全程不用切換 App。",
      items: [
        {
          emoji: "🤖",
          title: "AI 訊息解析",
          desc: "TravelSync 會讀取群組聊天，自動抓出目的地、日期與偏好，不用表單，也不用重複整理。",
        },
        {
          emoji: "🗳️",
          title: "視覺化群組投票",
          desc: "任何旅遊項目都能直接發起投票。成員可在 LINE 內看到附照片、評分與價格的卡片並立即投票。",
        },
        {
          emoji: "💰",
          title: "旅費分帳",
          desc: "旅途中隨手記錄共同支出。TravelSync 會自動計算誰該付誰，並找出最少轉帳次數的結算方式。",
        },
        {
          emoji: "📋",
          title: "共享旅行看板",
          desc: "所有決策都集中在看板上，例如待辦、投票中、已確認，讓每位成員都掌握同一份最新資訊。",
        },
      ],
    },
    steps: {
      heading: "3 個步驟快速上手",
      items: [
        {
          n: "1",
          title: "把 TravelSync 加入你的 LINE 群組",
          desc: "在 LINE 搜尋 @travelsync，加入任何群組聊天即可開始。",
        },
        {
          n: "2",
          title: "像平常一樣聊天討論行程",
          desc: "直接自然對話就好。像是說「我們住新宿附近的飯店吧」，TravelSync 就會自動加入看板。",
        },
        {
          n: "3",
          title: "投票、確認，然後出發",
          desc: "對任何項目輸入 /vote，成員就能直接在聊天中投票，系統也會自動確認勝出的選項。",
        },
      ],
    },
    commands: {
      heading: "簡單好用的斜線指令",
      subheading: "在你的 LINE 群組輸入這些指令就能開始。",
      items: [
        { cmd: "/start Osaka Jul 15-20", desc: "建立新旅程" },
        { cmd: "/vote hotel", desc: "發起視覺化投票" },
        { cmd: "/add book travel insurance", desc: "新增待辦事項" },
        { cmd: "/exp 3200 dinner for all", desc: "記錄共同支出" },
        { cmd: "/status", desc: "查看旅行看板" },
        { cmd: "/nudge", desc: "提醒尚未投票的成員" },
      ],
    },
    cta: {
      heading: "讓旅行規劃更聰明。",
      description:
        "把 TravelSync AI 加進你的 LINE 群組，讓機器人接手混亂瑣事，你們只要專心享受旅程。",
      button: "加入 TravelSync 到 LINE ->",
    },
    footer: {
      copyright: "© 2026 TravelSync AI。為旅行者打造。",
      help: "說明",
      openApp: "開啟 App",
    },
  },
} satisfies Record<
  Locale,
  {
    brand: string;
    nav: {
      features: string;
      howItWorks: string;
      addToLine: string;
      languageLabel: string;
      english: string;
      traditionalChinese: string;
    };
    hero: {
      badge: string;
      titleStart: string;
      titleHighlight: string;
      description: string;
      primaryCta: string;
      secondaryCta: string;
    };
    chat: {
      alice: string;
      travelsyncAdded: string;
      travelsyncAddedSuffix: string;
      bob: string;
      travelsyncExpense: string;
    };
    stats: Array<{ value: string; label: string }>;
    features: {
      heading: string;
      subheading: string;
      items: Array<{ emoji: string; title: string; desc: string }>;
    };
    steps: {
      heading: string;
      items: Array<{ n: string; title: string; desc: string }>;
    };
    commands: {
      heading: string;
      subheading: string;
      items: Array<{ cmd: string; desc: string }>;
    };
    cta: {
      heading: string;
      description: string;
      button: string;
    };
    footer: {
      copyright: string;
      help: string;
      openApp: string;
    };
  }
>;

export default function HomePageClient() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  const copy = CONTENT[locale];

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md dark:bg-[#0a0a0a]/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <span className="text-base font-bold tracking-tight text-[var(--foreground)]">
            ✈️ {copy.brand}
          </span>
          <nav className="flex items-center gap-3 text-sm text-[var(--muted-foreground)] sm:gap-6">
            <a href="#features" className="hidden transition-colors hover:text-[var(--foreground)] sm:block">
              {copy.nav.features}
            </a>
            <a href="#how-it-works" className="hidden transition-colors hover:text-[var(--foreground)] sm:block">
              {copy.nav.howItWorks}
            </a>
            <div
              className="flex items-center rounded-full border border-[var(--border)] bg-white p-1 dark:bg-[#111]"
              aria-label={copy.nav.languageLabel}
              role="group"
            >
              <button
                type="button"
                onClick={() => setLocale("en")}
                aria-pressed={locale === "en"}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  locale === "en"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {copy.nav.english}
              </button>
              <button
                type="button"
                onClick={() => setLocale("zh-TW")}
                aria-pressed={locale === "zh-TW"}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  locale === "zh-TW"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {copy.nav.traditionalChinese}
              </button>
            </div>
            <a
              href="#commands"
              className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {copy.nav.addToLine}
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-b from-white to-[#f0fdf0] px-5 pt-20 pb-24 dark:from-[#0a0a0a] dark:to-[#0d1a0d]">
          <div className="mx-auto max-w-2xl space-y-6 text-center">
            <span className="inline-block rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
              {copy.hero.badge}
            </span>
            <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-[var(--foreground)] sm:text-5xl">
              {copy.hero.titleStart}
              <br />
              <span className="text-[var(--primary)]">{copy.hero.titleHighlight}</span>
            </h1>
            <p className="mx-auto max-w-xl text-base leading-relaxed text-[var(--muted-foreground)] sm:text-lg">
              {copy.hero.description}
            </p>
            <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
              <a
                href="#commands"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                {copy.hero.primaryCta}
                <span aria-hidden>{"->"}</span>
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                {copy.hero.secondaryCta}
              </a>
            </div>
          </div>

          <div className="pointer-events-none mx-auto mt-16 max-w-sm space-y-3 select-none" aria-hidden>
            <ChatBubble
              align="left"
              name="Alice"
              color="bg-white dark:bg-[#1a1a1a] border border-[var(--border)]"
            >
              {copy.chat.alice}
            </ChatBubble>
            <ChatBubble
              align="right"
              name="TravelSync"
              color="bg-[#dcfce7] dark:bg-[#14532d]"
            >
              {copy.chat.travelsyncAdded}
              <span className="font-mono text-xs">/vote hotel</span>
              {copy.chat.travelsyncAddedSuffix}
            </ChatBubble>
            <ChatBubble
              align="left"
              name="Bob"
              color="bg-white dark:bg-[#1a1a1a] border border-[var(--border)]"
            >
              {copy.chat.bob}
            </ChatBubble>
            <ChatBubble
              align="right"
              name="TravelSync"
              color="bg-[#dcfce7] dark:bg-[#14532d]"
            >
              {copy.chat.travelsyncExpense}
            </ChatBubble>
          </div>
        </section>

        <div className="border-y border-[var(--border)] bg-[var(--secondary)] px-5 py-4 dark:bg-[#111]">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-6 text-center sm:gap-12">
            {copy.stats.map((stat) => (
              <div key={stat.label}>
                <p className="text-sm font-bold text-[var(--foreground)]">{stat.value}</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <section id="features" className="bg-white px-5 py-20 dark:bg-[#0a0a0a]">
          <div className="mx-auto max-w-4xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
                {copy.features.heading}
              </h2>
              <p className="mt-2 text-[var(--muted-foreground)]">{copy.features.subheading}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {copy.features.items.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="bg-[#f9fafb] px-5 py-20 dark:bg-[#111]">
          <div className="mx-auto max-w-3xl">
            <div className="mb-12 text-center">
              <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
                {copy.steps.heading}
              </h2>
            </div>
            <div className="space-y-8">
              {copy.steps.items.map((step) => (
                <div key={step.n} className="flex items-start gap-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                    {step.n}
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{step.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="commands" className="bg-white px-5 py-20 dark:bg-[#0a0a0a]">
          <div className="mx-auto max-w-3xl">
            <div className="mb-10 text-center">
              <h2 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
                {copy.commands.heading}
              </h2>
              <p className="mt-2 text-[var(--muted-foreground)]">{copy.commands.subheading}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {copy.commands.items.map((command) => (
                <div
                  key={command.cmd}
                  className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-4 dark:bg-[#111]"
                >
                  <code className="mt-0.5 shrink-0 rounded bg-[#dcfce7] px-2 py-0.5 text-xs font-mono text-[var(--primary)] dark:bg-[#14532d]">
                    {command.cmd.split(" ")[0]}
                  </code>
                  <div>
                    <p className="text-xs font-mono text-[var(--foreground)]">{command.cmd}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{command.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[var(--primary)] px-5 py-24 text-center text-white">
          <div className="mx-auto max-w-xl space-y-5">
            <h2 className="text-2xl font-bold sm:text-3xl">{copy.cta.heading}</h2>
            <p className="leading-relaxed text-white/80">{copy.cta.description}</p>
            <a
              href="#"
              className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-bold text-[var(--primary)] shadow transition-colors hover:bg-white/90"
            >
              {copy.cta.button}
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] px-5 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-sm text-[var(--muted-foreground)] sm:flex-row">
          <span className="font-medium text-[var(--foreground)]">✈️ {copy.brand}</span>
          <span>{copy.footer.copyright}</span>
          <nav className="flex gap-4">
            <Link href="/liff/help" className="transition-colors hover:text-[var(--foreground)]">
              {copy.footer.help}
            </Link>
            <Link href="/app" className="transition-colors hover:text-[var(--foreground)]">
              {copy.footer.openApp}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  emoji,
  title,
  desc,
}: {
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--secondary)] p-6 dark:bg-[#111]">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#dcfce7] text-xl dark:bg-[#14532d]">
        {emoji}
      </div>
      <h3 className="font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{desc}</p>
    </div>
  );
}

function ChatBubble({
  align,
  name,
  color,
  children,
}: {
  align: "left" | "right";
  name: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="px-1 text-xs text-[var(--muted-foreground)]">{name}</span>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-[var(--foreground)] shadow-sm ${
          color
        } ${align === "right" ? "rounded-tr-sm" : "rounded-tl-sm"}`}
      >
        {children}
      </div>
    </div>
  );
}
