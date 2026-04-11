export function toLiffErrorMessage(
  context: string,
  err: unknown,
  fallback: string
): string {
  const raw = err instanceof Error ? err.message.trim() : "";

  if (!raw) {
    return fallback;
  }

  if (raw === "Not authenticated. Please reopen in LINE.") {
    return "Please reopen this page inside LINE and try again.";
  }

  if (raw.includes("Failed to load session")) {
    return "We could not verify your LINE session. Reopen this page inside LINE and try again.";
  }

  if (raw.includes("Invalid or expired LIFF token")) {
    return "Your LINE session expired. Reopen this page inside LINE to continue.";
  }

  if (raw.includes("Missing Authorization header")) {
    return "This page must be opened from LINE to load correctly.";
  }

  if (raw.includes("Failed to load")) {
    return fallback;
  }

  if (raw.includes("Failed to")) {
    return `${fallback} (${context})`;
  }

  return raw;
}
