/**
 * Workspace icon set — 1.5px stroke, 18px viewBox tuned to the 24px radius
 * scale. Outline-only, no fills, no inner gradients. If a surface needs an
 * icon and it isn't here, add it here rather than reaching for lucide.
 */
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, strokeWidth = 1.5, ...rest }: Props) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export function IconCommand(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
    </svg>
  );
}

export function IconArrowUpRight(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}

export function IconCheck(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}

export function IconClose(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function IconVote(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M4 14h16v6H4zM4 14l4-9h8l4 9M9 9h6" />
    </svg>
  );
}

export function IconCoin(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7v1.5M12 15.5V17" />
    </svg>
  );
}

export function IconClock(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function IconPin(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function IconSpark(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />
    </svg>
  );
}

export function IconChevronRight(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconKanban(p: Props) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="4" width="6" height="14" rx="1.5" />
      <rect x="9" y="4" width="6" height="9" rx="1.5" />
      <rect x="15" y="4" width="6" height="6" rx="1.5" />
    </svg>
  );
}

export function IconUsers(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 19a5.5 5.5 0 0 0-4-5.3" />
    </svg>
  );
}

export function IconCalendar(p: Props) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconBell(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function IconBolt(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />
    </svg>
  );
}

export function IconStamp(p: Props) {
  // Postmark-style decorative stamp. One-time use on hero.
  return (
    <svg {...base(p)} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="26" strokeDasharray="2 3" />
      <circle cx="32" cy="32" r="20" />
      <path d="M16 32h32M32 16v32" strokeOpacity="0.35" />
    </svg>
  );
}
