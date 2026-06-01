'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Hero centerpiece — "the plan assembles". A source LINE message emits product
// cards that fan out, then glide and snap onto a spine into a tidy plan. Cards
// are real mini-UIs whose contents come alive on assembly (vote bar fills,
// expense settles, day ticks). Dependency-free CSS 3D, cursor parallax, dark
// mode, and a static assembled frame under reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Check, MapPin } from "lucide-react";

type Phase = "scatter" | "assembled";

type CardDef = {
  key: string;
  /** assembled position (px from center) + depth + slot on the spine */
  a: { x: number; y: number; z: number };
  /** scattered position (px from center) + depth + rotation */
  s: { x: number; y: number; z: number; r: number };
};

// Order matters: index drives the fly-in stagger and the spine slot.
const CARDS: CardDef[] = [
  { key: "vote", a: { x: -8, y: -92, z: 14 }, s: { x: -128, y: -34, z: 64, r: -12 } },
  { key: "split", a: { x: 8, y: -8, z: 30 }, s: { x: 124, y: -68, z: 30, r: 10 } },
  { key: "day", a: { x: -6, y: 76, z: 48 }, s: { x: -108, y: 58, z: 82, r: 8 } },
  { key: "pin", a: { x: 6, y: 158, z: 66 }, s: { x: 112, y: 92, z: 22, r: -9 } },
];

export default function PlanScene({ forceMotion }: { forceMotion: boolean }) {
  const [phase, setPhase] = useState<Phase>("assembled");
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduce = !forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // stays assembled (initial state)

    let timer: ReturnType<typeof setTimeout>;
    let assembled = true;
    const cycle = () => {
      assembled = !assembled;
      setPhase(assembled ? "assembled" : "scatter");
      timer = setTimeout(cycle, assembled ? 3400 : 1800);
    };
    timer = setTimeout(cycle, 3400);
    return () => clearTimeout(timer);
  }, [forceMotion]);

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = stageRef.current;
      if (!el || e.pointerType === "touch") return;
      if (!forceMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    },
    [forceMotion],
  );
  const reset = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty("--px", "0");
    el.style.setProperty("--py", "0");
  }, []);

  const live = phase === "assembled";

  return (
    <div
      ref={stageRef}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className="relative mx-auto aspect-square w-full max-w-[460px] select-none [perspective:1200px]"
      style={{ "--px": "0", "--py": "0" } as CSSProperties}
    >
      {/* Floor glow — grounds the stack in space. */}
      <div
        className="pointer-events-none absolute left-1/2 top-[58%] h-40 w-72 -translate-x-1/2 rounded-[50%] bg-[#00b900]/12 blur-3xl transition-opacity duration-700"
        style={{ opacity: live ? 1 : 0.35 }}
      />

      <div
        className="absolute inset-0 [transform-style:preserve-3d]"
        style={{
          transform: "rotateX(calc(var(--py) * -11deg)) rotateY(calc(var(--px) * 15deg))",
          transition: "transform 320ms cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Source chat bubble — the conversation the plan grows from. */}
        <div
          className="absolute left-1/2 top-1/2 w-[230px] -translate-x-1/2"
          style={{ transform: "translate3d(-50%, -196px, 8px)" }}
        >
          <div className="scene-bob flex items-start gap-2.5" style={{ animationDelay: "0ms" }}>
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#00b900] text-[11px] font-bold text-white">
              你
            </span>
            <div className="rounded-2xl rounded-tl-md border border-black/10 bg-white/95 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug shadow-[0_14px_34px_-22px_rgba(0,0,0,0.55)] backdrop-blur dark:border-white/12 dark:bg-[#14181a]/95 dark:text-[#e7ece9]">
              三月一起去東京吧 🗾
              <span className="ml-1 inline-flex gap-0.5 align-middle">
                <Dot /> <Dot delay="160ms" /> <Dot delay="320ms" />
              </span>
            </div>
          </div>
        </div>

        {/* Spine + nodes the cards snap onto. */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2"
          style={{
            transform: "translate3d(-50%, 33px, 0)",
            opacity: live ? 1 : 0,
            transition: "opacity 500ms ease 120ms",
          }}
        >
          <div className="h-[252px] w-px bg-gradient-to-b from-transparent via-[#00b900]/45 to-transparent" />
          {CARDS.map((c, i) => (
            <span
              key={c.key}
              className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#00b900]"
              style={{ top: `${(c.a.y + 92) * (252 / 250) - 2}px`, transitionDelay: `${i * 70}ms` }}
            />
          ))}
        </div>

        {/* The cards. */}
        {CARDS.map((c, i) => {
          const t = live
            ? `translate3d(calc(-50% + ${c.a.x}px), calc(-50% + ${c.a.y}px), ${c.a.z}px) rotate(0deg)`
            : `translate3d(calc(-50% + ${c.s.x}px), calc(-50% + ${c.s.y}px), ${c.s.z}px) rotate(${c.s.r}deg)`;
          return (
            <div
              key={c.key}
              className="absolute left-1/2 top-1/2 w-[224px]"
              style={{
                transform: t,
                transition: `transform 860ms cubic-bezier(0.32,0.72,0,1) ${i * 75}ms`,
                zIndex: 10 + i,
              }}
            >
              <div className="scene-bob" style={{ animationDelay: `${i * 600 + 200}ms` }}>
                <CardShell>
                  {c.key === "vote" && <VoteCard live={live} />}
                  {c.key === "split" && <SplitCard live={live} />}
                  {c.key === "day" && <DayCard live={live} />}
                  {c.key === "pin" && <PinCard />}
                </CardShell>
              </div>
            </div>
          );
        })}

        {/* Confirmed badge appears once the plan is assembled. */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2"
          style={{
            transform: "translate3d(-50%, 204px, 78px)",
            opacity: live ? 1 : 0,
            transition: "opacity 420ms ease 260ms",
          }}
        >
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-[#00b900] px-3.5 py-1.5 text-[12px] font-bold text-white shadow-[0_16px_34px_-16px_rgba(0,185,0,0.9)] ${live ? "accent-pulse" : ""}`}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Trip confirmed
          </span>
        </div>
      </div>
    </div>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return <span className="typing-dot inline-block h-1 w-1 rounded-full bg-[#00b900]/60" style={{ animationDelay: delay }} />;
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/95 p-3.5 shadow-[0_22px_48px_-26px_rgba(0,0,0,0.55)] backdrop-blur dark:border-white/12 dark:bg-[#14181a]/95">
      {children}
    </div>
  );
}

function CardHead({ label, badge }: { label: string; badge?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-[10px] font-bold tracking-[0.12em] text-[#8b938f] uppercase">{label}</span>
      {badge}
    </div>
  );
}

function VoteCard({ live }: { live: boolean }) {
  const rows = [
    { name: "Niseko ryokan", pct: 72, lead: true },
    { name: "Tokyo hotel", pct: 28, lead: false },
  ];
  return (
    <div className="dark:text-[#e7ece9]">
      <CardHead
        label="Vote · where to stay"
        badge={<span className="text-[10px] font-bold text-[#00b900]">{live ? "5/7" : "·"}</span>}
      />
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex items-center justify-between text-[12px] font-semibold">
              <span className="flex items-center gap-1.5">
                {r.lead && live && <Check className="h-3 w-3 text-[#00b900]" aria-hidden />}
                {r.name}
              </span>
              <span className="text-[#8b938f]">{live ? `${r.pct}%` : ""}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-[#00b900]"
                style={{ width: live ? `${r.pct}%` : "0%", transition: "width 760ms cubic-bezier(0.32,0.72,0,1) 320ms" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitCard({ live }: { live: boolean }) {
  return (
    <div className="dark:text-[#e7ece9]">
      <CardHead
        label="Split · group dinner"
        badge={
          <span
            className="rounded-full bg-[#00b900]/12 px-2 py-0.5 text-[10px] font-bold text-[#00b900]"
            style={{ opacity: live ? 1 : 0, transition: "opacity 360ms ease 420ms" }}
          >
            settled
          </span>
        }
      />
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[19px] font-bold tracking-tight">¥3,200</p>
          <p className="text-[11px] text-[#8b938f]">each · 3 people</p>
        </div>
        <div className="flex -space-x-1.5">
          {["#00b900", "#1fb6c9", "#7c5cff"].map((c) => (
            <span
              key={c}
              className="h-6 w-6 rounded-full border-2 border-white dark:border-[#14181a]"
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayCard({ live }: { live: boolean }) {
  const items = [
    { time: "10:00", text: "teamLab Planets" },
    { time: "13:30", text: "Ichiran ramen" },
  ];
  return (
    <div className="dark:text-[#e7ece9]">
      <CardHead
        label="Day 3 · Saturday"
        badge={
          <Check
            className="h-3.5 w-3.5 text-[#00b900]"
            style={{ opacity: live ? 1 : 0, transform: live ? "scale(1)" : "scale(0.4)", transition: "all 320ms var(--ease-confirm) 480ms" }}
            aria-hidden
          />
        }
      />
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.time} className="flex items-center gap-2 text-[12px]">
            <span className="text-mono w-9 shrink-0 text-[11px] font-semibold text-[#00b900]">{it.time}</span>
            <span className="h-1 w-1 rounded-full bg-[#8b938f]" />
            <span className="truncate font-medium">{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PinCard() {
  return (
    <div className="dark:text-[#e7ece9]">
      <CardHead label="Pin · saved spot" />
      <div className="relative h-[58px] overflow-hidden rounded-xl border border-black/8 bg-[radial-gradient(circle_at_30%_30%,rgba(0,185,0,0.10),transparent_60%)] dark:border-white/10">
        {/* faux map grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(120,140,130,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(120,140,130,0.18)_1px,transparent_1px)] bg-[size:18px_18px]" />
        <span className="absolute left-[58%] top-[42%] -translate-x-1/2 -translate-y-full">
          <MapPin className="h-5 w-5 fill-[#00b900] text-white" aria-hidden />
        </span>
        <span className="absolute bottom-2 left-2.5 text-[11px] font-semibold">Shibuya Crossing</span>
      </div>
    </div>
  );
}
