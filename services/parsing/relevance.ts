/**
 * Lightweight relevance filter.
 *
 * Runs before any LLM call to avoid burning tokens on messages that are
 * obviously not travel-related. Returns `false` to skip parsing entirely.
 *
 * Intentionally conservative — false positives (sending irrelevant messages
 * to the LLM) are cheap; false negatives (missing real travel info) are not.
 */

// Messages shorter than this are almost never travel-relevant
const MIN_CHARS = 4;

// Patterns that strongly suggest the message has no travel information.
// Tested against the most common LINE group chat non-travel patterns.
const IRRELEVANT_PATTERNS: RegExp[] = [
  /^(ok|ok+|好|好的|嗯|喔|哦|欸|ㄛ|ㄟ|ㄜ|哈+|呵+|lol|xd|😂|👍|🙏|❤️|😍|😅|😭|🥹)+$/i,
  /^(謝謝|感謝|thank|thanks|thx|ty)+[!！？?。.]*$/i,
  /^(早|晚安|午安|good morning|good night|gn|gm)[!！]*$/i,
  /^(收到|了解|知道了|沒問題|no problem|np|sure|yep|yeah|yes|no|nope)[!！。.]*$/i,
  /^\d{1,2}:\d{2}$/,   // just a time like "8:30"
];

// Keywords that strongly suggest travel relevance — presence of any means we
// skip the "too short" check and go straight to LLM.
const TRAVEL_KEYWORDS = [
  // destinations / geography
  "飯店", "旅館", "民宿", "hostel", "hotel",
  "機場", "航班", "班機", "flight", "airport",
  "餐廳", "restaurant", "吃", "食",
  "景點", "行程", "itinerary",
  "簽證", "visa",
  "旅遊", "旅行", "trip", "travel", "vacation",
  // dates / times (trip-relevant patterns)
  "月", "日", "出發", "回來", "幾號",
  // money
  "預算", "價格", "多少錢", "budget", "price", "nt$", "usd", "$",
  // booking
  "訂", "booking", "reserve",
  // transport
  "火車", "高鐵", "捷運", "巴士", "bus", "taxi", "計程車", "租車",
  // activity
  "行程", "活動", "玩", "景點", "門票", "ticket",
  // insurance
  "保險", "insurance",
];

export interface RelevanceResult {
  relevant: boolean;
  reason: "too_short" | "pattern_match" | "no_signal" | "has_travel_keyword" | "long_enough";
}

export function checkRelevance(text: string): RelevanceResult {
  const trimmed = text.trim();

  // 1. Definitely irrelevant patterns
  for (const pattern of IRRELEVANT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { relevant: false, reason: "pattern_match" };
    }
  }

  // 2. Strong travel signal — bypass length check
  const lower = trimmed.toLowerCase();
  for (const kw of TRAVEL_KEYWORDS) {
    if (lower.includes(kw)) {
      return { relevant: true, reason: "has_travel_keyword" };
    }
  }

  // 3. Too short to contain useful information
  if (trimmed.length < MIN_CHARS) {
    return { relevant: false, reason: "too_short" };
  }

  // 4. Contains a date-like pattern (e.g. 7/15, 7月15, 2026/7/15)
  if (/\d{1,2}[\/\-月]\d{1,2}/.test(trimmed)) {
    return { relevant: true, reason: "has_travel_keyword" };
  }

  // 5. Medium-length message — pass to LLM to decide
  if (trimmed.length >= 10) {
    return { relevant: true, reason: "long_enough" };
  }

  return { relevant: false, reason: "no_signal" };
}
