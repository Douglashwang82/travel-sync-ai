"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";
import {
  IconArrowUpRight,
  IconBolt,
  IconCalendar,
  IconCommand,
  IconCoin,
  IconKanban,
  IconPin,
  IconUsers,
  IconVote,
} from "@/components/app/icons";

const COPY = {
  en: {
    placeholder: "Run a command, jump to a tab…",
    sectionNav: "Jump",
    sectionDo: "Do",
    sectionTrip: "Trip",
    overview: "Overview",
    map: "Map",
    itinerary: "Itinerary",
    ideas: "Ideas",
    votes: "Votes",
    expenses: "Expenses",
    board: "Board",
    settings: "Settings",
    publish: "Publish itinerary",
    settle: "Settle expenses",
    addItem: "Add item",
    castVote: "Cast vote",
    nudgeOthers: "Nudge non-voters",
    markReady: "Mark trip ready",
    nothingFound: "No matches.",
    hint: "↵ to run · esc to close",
  },
  "zh-TW": {
    placeholder: "輸入指令或前往分頁…",
    sectionNav: "前往",
    sectionDo: "執行",
    sectionTrip: "旅程",
    overview: "總覽",
    map: "地圖",
    itinerary: "行程",
    ideas: "靈感",
    votes: "投票",
    expenses: "費用",
    board: "看板",
    settings: "設定",
    publish: "發布行程",
    settle: "結算費用",
    addItem: "新增項目",
    castVote: "投票",
    nudgeOthers: "提醒未投票成員",
    markReady: "標記為已準備",
    nothingFound: "沒有符合的指令。",
    hint: "↵ 執行 · Esc 關閉",
  },
} as const;

type CommandKind = "nav" | "do" | "trip";
interface Command {
  id: string;
  label: string;
  kind: CommandKind;
  hint?: string;
  keywords: string[];
  icon: React.ComponentType<{ size?: number }>;
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddItem?: () => void;
  onPublish?: () => void;
  onSettle?: () => void;
}

export function CommandPalette({
  tripId,
  open,
  onOpenChange,
  onAddItem,
  onPublish,
  onSettle,
}: CommandPaletteProps) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const base = `/app/trips/${tripId}`;

  const commands: Command[] = useMemo(
    () => [
      // Jump
      { id: "go:overview", label: copy.overview, kind: "nav", hint: "g o", keywords: ["overview", "home", "總覽"], icon: IconKanban, run: () => router.push(base) },
      { id: "go:map", label: copy.map, kind: "nav", hint: "g m", keywords: ["map", "地圖"], icon: IconPin, run: () => router.push(`${base}/map`) },
      { id: "go:itin", label: copy.itinerary, kind: "nav", hint: "g i", keywords: ["itinerary", "schedule", "行程"], icon: IconCalendar, run: () => router.push(`${base}/itinerary`) },
      { id: "go:ideas", label: copy.ideas, kind: "nav", hint: "g d", keywords: ["ideas", "靈感"], icon: IconBolt, run: () => router.push(`${base}/ideas`) },
      { id: "go:votes", label: copy.votes, kind: "nav", hint: "g v", keywords: ["vote", "votes", "投票"], icon: IconVote, run: () => router.push(`${base}/votes`) },
      { id: "go:exp", label: copy.expenses, kind: "nav", hint: "g e", keywords: ["expenses", "money", "exp", "費用"], icon: IconCoin, run: () => router.push(`${base}/expenses`) },
      { id: "go:board", label: copy.board, kind: "nav", hint: "g b", keywords: ["board", "kanban", "看板"], icon: IconKanban, run: () => router.push(`${base}/board`) },
      { id: "go:settings", label: copy.settings, kind: "nav", hint: "g s", keywords: ["settings", "members", "設定"], icon: IconUsers, run: () => router.push(`${base}/settings`) },
      // Do
      { id: "do:add", label: copy.addItem, kind: "do", hint: "n", keywords: ["add", "new", "item", "新增"], icon: IconBolt, run: () => onAddItem?.() },
      { id: "do:vote", label: copy.castVote, kind: "do", hint: "/vote", keywords: ["/vote", "vote", "投"], icon: IconVote, run: () => router.push(`${base}/votes`) },
      { id: "do:exp", label: copy.expenses, kind: "do", hint: "/exp", keywords: ["/exp", "expense", "費"], icon: IconCoin, run: () => router.push(`${base}/expenses`) },
      { id: "do:nudge", label: copy.nudgeOthers, kind: "do", hint: "/ops nudge", keywords: ["nudge", "ops", "提醒"], icon: IconBolt, run: () => router.push(base) },
      { id: "do:ready", label: copy.markReady, kind: "do", hint: "/ready", keywords: ["/ready", "ready", "準備"], icon: IconBolt, run: () => router.push(`${base}/publish`) },
      // Trip
      { id: "trip:publish", label: copy.publish, kind: "trip", hint: "/publish", keywords: ["publish", "lock", "發布"], icon: IconArrowUpRight, run: () => (onPublish ? onPublish() : router.push(`${base}/publish`)) },
      { id: "trip:settle", label: copy.settle, kind: "trip", hint: "/settle", keywords: ["settle", "結算"], icon: IconCoin, run: () => (onSettle ? onSettle() : router.push(`${base}/expenses`)) },
    ],
    [router, base, copy, onAddItem, onPublish, onSettle]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => {
      const hay = [c.label, c.hint ?? "", ...c.keywords].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  // Reset the highlighted index when the query or open-state changes —
  // canonical React 19 "adjust state on prop change" pattern.
  const [prevReset, setPrevReset] = useState({ query, open });
  if (prevReset.query !== query || prevReset.open !== open) {
    setPrevReset({ query, open });
    if (active !== 0) setActive(0);
  }

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) {
        void cmd.run();
        onOpenChange(false);
      }
    }
  }

  const sections: Array<[CommandKind, string]> = [
    ["nav", copy.sectionNav],
    ["do", copy.sectionDo],
    ["trip", copy.sectionTrip],
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(20_19_15_/_0.45)] backdrop-blur-sm" />
        <Dialog.Content
          className="surface-glass fixed left-1/2 top-[14vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-tile)] border border-[var(--border-hairline)] shadow-[var(--shadow-deep)]"
          onKeyDown={handleKey}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">{copy.placeholder}</Dialog.Description>

          <div className="flex items-center gap-3 border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3">
            <IconCommand size={16} className="text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.placeholder}
              className="w-full bg-transparent text-base text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
              aria-autocomplete="list"
              aria-controls="command-list"
              aria-activedescendant={filtered[active]?.id}
            />
            <span className="hidden text-[10px] text-[var(--text-faint)] sm:block">{copy.hint}</span>
          </div>

          <ul
            id="command-list"
            role="listbox"
            className="max-h-[60vh] overflow-y-auto bg-[var(--surface-raised)] p-2"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                {copy.nothingFound}
              </li>
            ) : (
              sections.map(([kind, sectionLabel]) => {
                const rows = filtered.filter((c) => c.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <li key={kind} className="py-1">
                    <p className="px-2 pb-1 text-caps">{sectionLabel}</p>
                    <ul className="space-y-0.5">
                      {rows.map((c) => {
                        const idx = filtered.indexOf(c);
                        const isActive = idx === active;
                        const Icon = c.icon;
                        return (
                          <li key={c.id}>
                            <button
                              id={c.id}
                              role="option"
                              aria-selected={isActive}
                              type="button"
                              onMouseEnter={() => setActive(idx)}
                              onClick={() => {
                                void c.run();
                                onOpenChange(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                                isActive
                                  ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]/60"
                              )}
                            >
                              <span className="text-[var(--text-muted)]">
                                <Icon size={16} />
                              </span>
                              <span className="flex-1 truncate">{c.label}</span>
                              {c.hint && (
                                <span className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-1.5 py-0.5 text-[10px] text-mono text-[var(--text-muted)]">
                                  {c.hint}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Hook: bind ⌘K / Ctrl+K to toggle the palette. */
export function useCommandPalette(): { open: boolean; setOpen: (o: boolean) => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return { open, setOpen };
}
