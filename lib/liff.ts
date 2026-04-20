const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim() || "";

function buildLiffUrl(path: string): string | null {
  if (!liffId) {
    return null;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://liff.line.me/${liffId}${normalizedPath}`;
}

export function getLiffUrls() {
  return {
    dashboard: buildLiffUrl("/dashboard"),
    itinerary: buildLiffUrl("/itinerary"),
  };
}

export function hasLiffConfigured(): boolean {
  return Boolean(liffId);
}
