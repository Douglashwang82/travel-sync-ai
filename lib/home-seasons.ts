// ─────────────────────────────────────────────────────────────────────────────
// Home seasons catalog — climate, crowd, price and festival data powering the
// "pick your dates" phase of the index-page survey pipeline.
//
// Like lib/home-survey.ts this module is client-safe and static: monthly
// normals per climate zone (approximate real-world values), recurring
// festival windows per country, a 0-100 desirability score per month, and a
// scanner that finds the best travel window of a given length inside the
// booking horizon. Everything is deterministic so server and client agree.
// ─────────────────────────────────────────────────────────────────────────────

import type { HomeCountryCode } from "@/lib/home-survey";

export interface HomeMonthInfo {
  /** Calendar month 1-12. */
  month: number;
  /** Average daily high / low, °C. */
  hiC: number;
  loC: number;
  /** Days with measurable rain in a typical month. */
  rainDays: number;
  /** Tourist crowding 1 (quiet) – 5 (packed). */
  crowd: number;
  /** Flight + hotel price level 1 (cheap) – 5 (peak). */
  price: number;
  note: string;
  noteZh: string;
}

export interface HomeSeasonEvent {
  id: string;
  emoji: string;
  name: string;
  nameZh: string;
  /** Restrict to one city; omitted = country-wide. */
  city?: string;
  /** Recurring annual window (month/day, inclusive). May wrap the year end. */
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}

/** A recurring event resolved to concrete dates inside the booking horizon. */
export interface HomeSeasonEventOccurrence {
  event: HomeSeasonEvent;
  /** ISO YYYY-MM-DD, inclusive. */
  startIso: string;
  endIso: string;
}

export type HomeMonthRating = "best" | "good" | "fair";

// ─── ISO date helpers (UTC-based, no timezone drift) ─────────────────────────

export function isoToday(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function isoDiffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function isoWeekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function isoMonth(iso: string): number {
  return Number(iso.slice(5, 7));
}

// ─── Climate zones ────────────────────────────────────────────────────────────

// Rows: [hiC, loC, rainDays, crowd, price] Jan → Dec, with bilingual notes.
type ZoneRow = [number, number, number, number, number, string, string];

const ZONES: Record<string, ZoneRow[]> = {
  // Honshu core (Tokyo / Kyoto / Osaka share the pattern closely enough).
  jp: [
    [10, 1, 5, 2, 2, "Crisp, clear and quiet — the coldest month", "晴朗乾冷、遊客最少的月份"],
    [10, 2, 6, 2, 2, "Cold, with early plum blossoms", "寒冷，梅花初開"],
    [14, 5, 9, 4, 4, "Warming up; sakura starts late March", "回暖，三月底櫻花初開"],
    [19, 10, 9, 5, 5, "Cherry-blossom peak — book everything early", "櫻花滿開，住宿交通須早訂"],
    [23, 15, 10, 4, 4, "Fresh green and mild; Golden Week is packed", "新綠宜人，黃金週人潮爆滿"],
    [26, 19, 12, 2, 2, "Tsuyu rainy season — hydrangeas and low fares", "梅雨季，繡球花與淡季優惠"],
    [30, 23, 11, 3, 3, "Hot and humid; festival and fireworks season", "濕熱，祭典與花火大會季節"],
    [31, 24, 9, 4, 4, "Hottest month; Obon travel rush mid-August", "最熱月份，八月中盂蘭盆節返鄉潮"],
    [27, 21, 12, 3, 3, "Still warm, with occasional typhoons", "餘熱未消，偶有颱風"],
    [22, 15, 9, 3, 3, "Comfortable autumn air — a sweet spot", "秋高氣爽，旅遊甜蜜點"],
    [17, 9, 6, 4, 4, "Autumn foliage peaks in gardens and temples", "庭園寺社紅葉最盛"],
    [12, 4, 5, 3, 3, "Cold, dry and lit up for the holidays", "乾冷，聖誕燈飾點亮街頭"],
  ],
  // Taipei basin (Taipei / New Taipei).
  tw: [
    [19, 14, 12, 3, 3, "Cool and drizzly — hot-spring weather", "濕涼有雨，正是泡溫泉的天氣"],
    [19, 14, 13, 4, 4, "Lunar New Year — festive but busy", "農曆春節，熱鬧但人多"],
    [22, 16, 14, 3, 3, "Mild, with frequent light rain", "溫和，常有細雨"],
    [26, 19, 13, 3, 3, "Warm spring before the plum rains", "梅雨前的溫暖春日"],
    [29, 22, 15, 2, 2, "Plum-rain season begins — pack a poncho", "梅雨季開始，記得帶雨具"],
    [32, 24, 15, 2, 2, "Hot, with afternoon thunderstorms", "炎熱，午後雷陣雨"],
    [34, 26, 11, 3, 3, "Peak heat; typhoon season starts", "最熱月份，颱風季展開"],
    [33, 26, 13, 3, 3, "Hot and stormy — typhoon peak", "濕熱多雨，颱風高峰"],
    [31, 24, 12, 2, 2, "Heat eases; typhoons taper off", "暑氣漸退，颱風漸少"],
    [27, 22, 10, 3, 3, "Dry, warm and stable — a top pick", "乾爽穩定，全年首選之一"],
    [24, 19, 9, 3, 3, "Pleasantly warm autumn days", "暖秋舒適宜人"],
    [20, 15, 10, 3, 4, "Mild; New Year's Eve at Taipei 101", "涼爽，台北 101 跨年夜"],
  ],
  "us-ny": [
    [4, -3, 10, 2, 2, "Freezing but cheap; snow-dusted parks", "冰冷但便宜，公園覆雪"],
    [6, -2, 9, 2, 2, "Deep winter; museums without lines", "隆冬，逛博物館不用排隊"],
    [11, 2, 11, 3, 3, "Thawing out; changeable weather", "回暖中，天氣多變"],
    [17, 7, 11, 3, 3, "Spring blooms across Central Park", "中央公園春花盛開"],
    [22, 12, 11, 4, 4, "Warm, green and lively", "溫暖翠綠，活力十足"],
    [27, 18, 10, 4, 4, "Early summer; rooftop season opens", "初夏，屋頂酒吧季開跑"],
    [29, 21, 10, 4, 4, "Hot and buzzing; July 4 fireworks", "炎熱熱鬧，國慶煙火"],
    [28, 20, 9, 3, 3, "Humid; locals leave and lines shrink", "濕熱，本地人度假去、排隊變短"],
    [24, 16, 8, 4, 4, "Golden light and perfect temperatures", "秋光正好，氣溫完美"],
    [18, 10, 8, 4, 4, "Crisp air and fall color", "涼爽清朗，滿城秋色"],
    [12, 5, 9, 4, 5, "Thanksgiving parade and early lights", "感恩節遊行與提早點燈"],
    [7, 0, 10, 5, 5, "Holiday windows, markets — and crowds", "聖誕櫥窗與市集，人潮最多"],
  ],
  "us-sf": [
    [14, 8, 11, 2, 2, "Mild, rainy 'green season'", "溫和多雨的綠色季節"],
    [16, 9, 10, 2, 2, "Showers with bright breaks", "陣雨與放晴交替"],
    [17, 10, 9, 3, 3, "Spring arrives early here", "春天來得早"],
    [18, 10, 5, 3, 3, "Clear days before the fog rolls in", "起霧季前的晴朗日子"],
    [19, 11, 3, 3, 3, "Dry and breezy — bring layers", "乾爽有風，洋蔥式穿搭"],
    [21, 12, 1, 3, 3, "Fog ('Karl') hugs the bridge", "霧氣 Karl 籠罩大橋"],
    [21, 13, 1, 4, 4, "Cool foggy mornings, busy piers", "霧涼早晨，碼頭人潮多"],
    [22, 13, 1, 4, 4, "Fog burns off by afternoon", "午後霧散"],
    [23, 14, 1, 3, 3, "The real SF summer — clearest skies", "舊金山真正的夏天，天空最清澈"],
    [22, 13, 3, 3, 3, "Warm, golden and fog-free", "溫暖金黃、少霧"],
    [18, 11, 8, 2, 2, "Quiet shoulder season", "安靜的淡季"],
    [14, 8, 11, 3, 3, "Rainy, with festive lights", "多雨，節慶燈飾"],
  ],
  "us-la": [
    [20, 9, 6, 2, 2, "Sunny winter days, cool nights", "冬陽和煦，夜晚微涼"],
    [20, 10, 6, 2, 2, "Occasional rain, mostly sun", "偶雨，多半晴朗"],
    [21, 11, 5, 3, 3, "Spring warmth begins", "春暖展開"],
    [23, 12, 3, 3, 3, "Dry and comfortable", "乾爽舒適"],
    [24, 14, 1, 3, 3, "'May gray' morning clouds", "五月灰：清晨雲層偏多"],
    [26, 16, 1, 3, 3, "'June gloom' burns off by noon", "六月陰：中午前放晴"],
    [29, 18, 0, 4, 4, "Peak beach season", "海灘旺季"],
    [29, 18, 0, 4, 4, "Hot inland, perfect on the coast", "內陸炎熱，海岸剛剛好"],
    [28, 17, 1, 3, 3, "Warm seas, thinner crowds", "海水暖，人潮少"],
    [26, 15, 2, 3, 3, "Golden autumn light", "金色秋光"],
    [23, 11, 3, 2, 2, "Quiet, warm and cheap", "安靜溫暖又划算"],
    [20, 9, 5, 3, 3, "Mild, with holiday sparkle", "溫和，節慶氣氛濃"],
  ],
};

function zoneKey(country: HomeCountryCode, city: string): string {
  if (country === "jp") return "jp";
  if (country === "tw") return "tw";
  if (city === "San Francisco") return "us-sf";
  if (city === "Los Angeles") return "us-la";
  return "us-ny";
}

export function getHomeCityMonths(country: HomeCountryCode, city: string): HomeMonthInfo[] {
  return ZONES[zoneKey(country, city)].map(([hiC, loC, rainDays, crowd, price, note, noteZh], i) => ({
    month: i + 1,
    hiC,
    loC,
    rainDays,
    crowd,
    price,
    note,
    noteZh,
  }));
}

// ─── Festivals & seasonal events ──────────────────────────────────────────────

const EVENTS: Record<HomeCountryCode, HomeSeasonEvent[]> = {
  jp: [
    { id: "jp-sakura", emoji: "🌸", name: "Cherry blossom season", nameZh: "櫻花季", startMonth: 3, startDay: 20, endMonth: 4, endDay: 10 },
    { id: "jp-golden-week", emoji: "🎏", name: "Golden Week holidays", nameZh: "黃金週連假", startMonth: 4, startDay: 29, endMonth: 5, endDay: 5 },
    { id: "jp-gion", emoji: "🏮", name: "Gion Matsuri", nameZh: "祇園祭", city: "Kyoto", startMonth: 7, startDay: 1, endMonth: 7, endDay: 31 },
    { id: "jp-sumida", emoji: "🎆", name: "Sumida River Fireworks", nameZh: "隅田川花火大會", city: "Tokyo", startMonth: 7, startDay: 25, endMonth: 7, endDay: 25 },
    { id: "jp-obon", emoji: "👘", name: "Obon week", nameZh: "盂蘭盆節", startMonth: 8, startDay: 13, endMonth: 8, endDay: 16 },
    { id: "jp-koyo", emoji: "🍁", name: "Autumn foliage", nameZh: "紅葉季", startMonth: 11, startDay: 15, endMonth: 12, endDay: 5 },
    { id: "jp-illumination", emoji: "✨", name: "Winter illuminations", nameZh: "冬季燈飾", startMonth: 12, startDay: 1, endMonth: 12, endDay: 31 },
  ],
  tw: [
    { id: "tw-lny", emoji: "🧧", name: "Lunar New Year", nameZh: "農曆春節", startMonth: 2, startDay: 5, endMonth: 2, endDay: 13 },
    { id: "tw-lantern", emoji: "🏮", name: "Pingxi Sky Lanterns", nameZh: "平溪天燈節", city: "New Taipei", startMonth: 2, startDay: 24, endMonth: 3, endDay: 2 },
    { id: "tw-mango", emoji: "🥭", name: "Mango & fruit season", nameZh: "芒果與水果季", startMonth: 5, startDay: 15, endMonth: 7, endDay: 31 },
    { id: "tw-dragonboat", emoji: "🚣", name: "Dragon Boat Festival", nameZh: "端午節", startMonth: 6, startDay: 9, endMonth: 6, endDay: 11 },
    { id: "tw-nye", emoji: "🎆", name: "Taipei 101 New Year's Eve", nameZh: "台北 101 跨年煙火", city: "Taipei", startMonth: 12, startDay: 31, endMonth: 12, endDay: 31 },
  ],
  us: [
    { id: "us-july4", emoji: "🎆", name: "Independence Day fireworks", nameZh: "國慶日煙火", startMonth: 7, startDay: 4, endMonth: 7, endDay: 4 },
    { id: "us-halloween", emoji: "🎃", name: "Halloween", nameZh: "萬聖節", startMonth: 10, startDay: 31, endMonth: 10, endDay: 31 },
    { id: "us-thanksgiving", emoji: "🦃", name: "Thanksgiving & parade", nameZh: "感恩節與大遊行", startMonth: 11, startDay: 25, endMonth: 11, endDay: 28 },
    { id: "us-holidays", emoji: "🎄", name: "Holiday season", nameZh: "聖誕節慶季", startMonth: 12, startDay: 1, endMonth: 12, endDay: 26 },
    { id: "us-nye", emoji: "🥂", name: "Times Square New Year's Eve", nameZh: "時報廣場跨年", city: "New York", startMonth: 12, startDay: 31, endMonth: 12, endDay: 31 },
  ],
};

export function getHomeSeasonEvents(country: HomeCountryCode, city: string): HomeSeasonEvent[] {
  return EVENTS[country].filter((e) => !e.city || e.city === city);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Resolves recurring events to concrete date windows that overlap
 * [fromIso, fromIso + horizonDays]. Sorted by start date.
 */
export function expandHomeSeasonEvents(
  events: HomeSeasonEvent[],
  fromIso: string,
  horizonDays: number,
): HomeSeasonEventOccurrence[] {
  const untilIso = isoAddDays(fromIso, horizonDays);
  const fromYear = Number(fromIso.slice(0, 4));
  const out: HomeSeasonEventOccurrence[] = [];
  for (const event of events) {
    const wraps = event.endMonth < event.startMonth || (event.endMonth === event.startMonth && event.endDay < event.startDay);
    for (let year = fromYear - 1; year <= fromYear + 2; year++) {
      const startIso = `${year}-${pad2(event.startMonth)}-${pad2(event.startDay)}`;
      const endIso = `${wraps ? year + 1 : year}-${pad2(event.endMonth)}-${pad2(event.endDay)}`;
      if (endIso < fromIso || startIso > untilIso) continue;
      out.push({ event, startIso, endIso });
    }
  }
  return out.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * 0-100 desirability: comfort of the daily mean temperature, dryness, and how
 * calm/cheap the month is. Absolute across zones, so tropical summers and
 * blizzard winters both sink — ratings below re-rank relatively per city.
 */
export function homeMonthScore(m: HomeMonthInfo): number {
  const mid = (m.hiC + m.loC) / 2;
  const comfort = Math.max(0, 40 - Math.abs(mid - 18) * 2.6);
  const dry = Math.max(0, 26 - m.rainDays * 2);
  const calm = (5 - m.crowd) * 4;
  const value = (5 - m.price) * 4.75;
  return Math.round(comfort + dry + calm + value);
}

/**
 * Relative rating per city: the top three scoring months are "best", months at
 * or above the city's median are "good", the rest "fair". Keeps warm-climate
 * cities from reading as all-fair against an absolute scale.
 */
export function rateHomeMonths(months: HomeMonthInfo[]): Map<number, HomeMonthRating> {
  const scored = months.map((m) => ({ month: m.month, score: homeMonthScore(m) }));
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const bestMonths = new Set(sorted.slice(0, 3).map((s) => s.month));
  const median = sorted[Math.floor(sorted.length / 2)].score;
  return new Map(
    scored.map((s) => [s.month, bestMonths.has(s.month) ? "best" : s.score >= median ? "good" : "fair"]),
  );
}

export interface HomeBestWindow {
  start: string;
  end: string;
  score: number;
}

/**
 * Scans every candidate start date in the horizon and returns the best-scoring
 * window of `lengthDays`: average month score per day, a bonus per distinct
 * festival the window overlaps, and a nudge toward Fri/Sat departures.
 */
export function findHomeBestWindow(
  country: HomeCountryCode,
  city: string,
  lengthDays: number,
  fromIso: string,
  horizonDays = 365,
): HomeBestWindow {
  const months = getHomeCityMonths(country, city);
  const scoreByMonth = new Map(months.map((m) => [m.month, homeMonthScore(m)]));
  const occurrences = expandHomeSeasonEvents(getHomeSeasonEvents(country, city), fromIso, horizonDays);

  let best: HomeBestWindow = { start: fromIso, end: isoAddDays(fromIso, lengthDays - 1), score: -1 };
  for (let offset = 0; offset <= horizonDays - lengthDays; offset++) {
    const start = isoAddDays(fromIso, offset);
    const end = isoAddDays(start, lengthDays - 1);
    let daySum = 0;
    for (let d = 0; d < lengthDays; d++) daySum += scoreByMonth.get(isoMonth(isoAddDays(start, d))) ?? 0;
    const eventBonus = occurrences.filter((o) => o.startIso <= end && o.endIso >= start).length * 6;
    const weekday = isoWeekday(start);
    const departureBonus = weekday === 5 || weekday === 6 ? 3 : 0;
    const score = daySum / lengthDays + eventBonus + departureBonus;
    if (score > best.score) best = { start, end, score };
  }
  return best;
}
