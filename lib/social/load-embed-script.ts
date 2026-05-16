import type { SocialPlatform } from "./detect";

interface PlatformScript {
  src: string;
  /** Called after the script loads so it (re)scans the DOM for new embeds. */
  reprocess: () => void;
}

const SCRIPTS: Record<Exclude<SocialPlatform, "youtube" | "facebook">, PlatformScript> = {
  instagram: {
    src: "https://www.instagram.com/embed.js",
    reprocess: () => {
      const w = window as unknown as { instgrm?: { Embeds?: { process: () => void } } };
      w.instgrm?.Embeds?.process();
    },
  },
  threads: {
    src: "https://www.threads.net/embed.js",
    // Threads embed.js re-scans automatically on load; no public reprocess API.
    reprocess: () => {},
  },
};

const loaders = new Map<string, Promise<void>>();

function loadOnce(src: string): Promise<void> {
  const cached = loaders.get(src);
  if (cached) return cached;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error(`Failed to load ${src}`)),
          { once: true },
        );
      }
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.addEventListener(
      "load",
      () => {
        el.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      "error",
      () => reject(new Error(`Failed to load ${src}`)),
      { once: true },
    );
    document.head.appendChild(el);
  });

  loaders.set(src, promise);
  return promise;
}

/**
 * Ensures the platform's embed script is loaded exactly once per page, then
 * asks it to (re)scan the DOM. Safe to call repeatedly from mounted embeds —
 * the actual network fetch happens only the first time.
 */
export async function loadAndReprocess(
  platform: Exclude<SocialPlatform, "youtube" | "facebook">,
): Promise<void> {
  const spec = SCRIPTS[platform];
  await loadOnce(spec.src);
  spec.reprocess();
}
