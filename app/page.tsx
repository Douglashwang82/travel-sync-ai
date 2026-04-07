import Link from "next/link";

// ─── Feature data ─────────────────────────────────────────────────────────────

const FEATURES = [
  {
    emoji: "🤖",
    title: "AI Message Parsing",
    desc: "TravelSync reads your group chat and automatically extracts destinations, dates, and preferences — no forms, no friction.",
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
    desc: "Every decision lives on a Kanban board — To-Do, Pending vote, Confirmed. Everyone in the group sees the same picture.",
  },
];

const STEPS = [
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
];

const COMMANDS = [
  { cmd: "/start Osaka Jul 15–20", desc: "Create a new trip" },
  { cmd: "/vote hotel", desc: "Start a visual vote" },
  { cmd: "/add book travel insurance", desc: "Add a to-do item" },
  { cmd: "/exp 3200 dinner for all", desc: "Log a shared expense" },
  { cmd: "/status", desc: "Show the trip board" },
  { cmd: "/nudge", desc: "Remind non-voters" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-[#0a0a0a]">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <span className="font-bold text-base tracking-tight text-[var(--foreground)]">
            ✈️ TravelSync AI
          </span>
          <nav className="flex items-center gap-6 text-sm text-[var(--muted-foreground)]">
            <a href="#features" className="hidden sm:block hover:text-[var(--foreground)] transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hidden sm:block hover:text-[var(--foreground)] transition-colors">
              How it works
            </a>
            <a
              href="#commands"
              className="px-4 py-1.5 rounded-full bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Add to LINE
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-white to-[#f0fdf0] dark:from-[#0a0a0a] dark:to-[#0d1a0d] pt-20 pb-24 px-5">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
              Built for LINE groups
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight text-[var(--foreground)]">
              Plan group trips,
              <br />
              <span className="text-[var(--primary)]">not group chats.</span>
            </h1>
            <p className="text-base sm:text-lg text-[var(--muted-foreground)] max-w-xl mx-auto leading-relaxed">
              TravelSync AI reads your LINE group chat, turns scattered
              conversations into an organised trip board, and helps your group
              make decisions — all without leaving LINE.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <a
                href="#commands"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-[var(--primary)] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-sm"
              >
                Add to LINE
                <span aria-hidden>→</span>
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full border border-[var(--border)] text-[var(--foreground)] font-medium text-sm hover:bg-[var(--secondary)] transition-colors"
              >
                See how it works
              </a>
            </div>
          </div>

          {/* Mock chat bubble decoration */}
          <div className="mt-16 max-w-sm mx-auto space-y-3 select-none pointer-events-none" aria-hidden>
            <ChatBubble
              align="left"
              name="Alice"
              color="bg-white dark:bg-[#1a1a1a] border border-[var(--border)]"
            >
              Anyone know a good hotel near Namba? 🏨
            </ChatBubble>
            <ChatBubble
              align="right"
              name="TravelSync"
              color="bg-[#dcfce7] dark:bg-[#14532d]"
            >
              Got it! I've added "Hotel near Namba" to the trip board. Type{" "}
              <span className="font-mono text-xs">/vote hotel</span> to start
              comparing options.
            </ChatBubble>
            <ChatBubble
              align="left"
              name="Bob"
              color="bg-white dark:bg-[#1a1a1a] border border-[var(--border)]"
            >
              I paid ¥8,400 for dinner last night
            </ChatBubble>
            <ChatBubble
              align="right"
              name="TravelSync"
              color="bg-[#dcfce7] dark:bg-[#14532d]"
            >
              Logged! Dinner ¥8,400 split 4 ways (¥2,100 each). Check the
              expense board for the full summary.
            </ChatBubble>
          </div>
        </section>

        {/* Stats bar */}
        <div className="border-y border-[var(--border)] bg-[var(--secondary)] dark:bg-[#111] py-4 px-5">
          <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-6 sm:gap-12 text-center">
            {[
              { value: "LINE-native", label: "No extra apps" },
              { value: "AI-powered", label: "Auto-parses chats" },
              { value: "Free", label: "Always" },
            ].map((s) => (
              <div key={s.label}>
                <p className="font-bold text-sm text-[var(--foreground)]">{s.value}</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <section id="features" className="py-20 px-5 bg-white dark:bg-[#0a0a0a]">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
                Everything your group needs
              </h2>
              <p className="mt-2 text-[var(--muted-foreground)]">
                From idea to itinerary, without switching apps.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              {FEATURES.map((f) => (
                <FeatureCard key={f.title} {...f} />
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="py-20 px-5 bg-[#f9fafb] dark:bg-[#111]"
        >
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
                Up and running in 3 steps
              </h2>
            </div>
            <div className="space-y-8">
              {STEPS.map((s, i) => (
                <div key={i} className="flex gap-5 items-start">
                  <div className="w-10 h-10 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {s.n}
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{s.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)] leading-relaxed">
                      {s.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Commands */}
        <section id="commands" className="py-20 px-5 bg-white dark:bg-[#0a0a0a]">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
                Simple slash commands
              </h2>
              <p className="mt-2 text-[var(--muted-foreground)]">
                Type these in your LINE group to get started.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {COMMANDS.map((c) => (
                <div
                  key={c.cmd}
                  className="flex items-start gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)] dark:bg-[#111]"
                >
                  <code className="text-xs font-mono text-[var(--primary)] bg-[#dcfce7] dark:bg-[#14532d] px-2 py-0.5 rounded shrink-0 mt-0.5">
                    {c.cmd.split(" ")[0]}
                  </code>
                  <div>
                    <p className="text-xs font-mono text-[var(--foreground)]">{c.cmd}</p>
                    <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-5 bg-[var(--primary)] text-white text-center">
          <div className="max-w-xl mx-auto space-y-5">
            <h2 className="text-2xl sm:text-3xl font-bold">
              Start planning smarter.
            </h2>
            <p className="text-white/80 leading-relaxed">
              Add TravelSync AI to your LINE group and let the bot handle the
              chaos while you focus on the fun.
            </p>
            <a
              href="#"
              className="inline-flex items-center gap-2 px-8 py-3 rounded-full bg-white text-[var(--primary)] font-bold text-sm hover:bg-white/90 transition-colors shadow"
            >
              Add TravelSync to LINE →
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-8 px-5">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">✈️ TravelSync AI</span>
          <span>© 2026 TravelSync AI. Built for travelers.</span>
          <nav className="flex gap-4">
            <Link href="/liff/help" className="hover:text-[var(--foreground)] transition-colors">
              Help
            </Link>
            <Link href="/liff/dashboard" className="hover:text-[var(--foreground)] transition-colors">
              Open App
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

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
    <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--secondary)] dark:bg-[#111] space-y-3">
      <div className="w-11 h-11 rounded-xl bg-[#dcfce7] dark:bg-[#14532d] flex items-center justify-center text-xl">
        {emoji}
      </div>
      <h3 className="font-semibold text-[var(--foreground)]">{title}</h3>
      <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{desc}</p>
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
      <span className="text-xs text-[var(--muted-foreground)] px-1">{name}</span>
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm text-[var(--foreground)] leading-relaxed shadow-sm ${color} ${
          align === "right" ? "rounded-tr-sm" : "rounded-tl-sm"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
