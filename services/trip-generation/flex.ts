// ─────────────────────────────────────────────────────────────────────────────
// Flex builders for the /plan survey.
//
// One bubble per question. Each quick-reply button emits a postback:
//   survey|<sessionId>|<questionKey>|<value>
//
// `must_haves` and `destination` accept free text — the bot replies with a
// hint inline and provides "skip" buttons; the user types in chat to answer.
// (DM follow-up for must_haves is in the design but cut from this first pass
// to keep the flow single-channel.)
// ─────────────────────────────────────────────────────────────────────────────

import type { messagingApi } from "@line/bot-sdk";
import type { SurveyQuestionKey } from "./index";

type FlexBubble = messagingApi.FlexBubble;
type FlexComponent = messagingApi.FlexComponent;

interface QuickReplyOption {
  label: string;
  value: string;
}

function pb(sessionId: string, key: string, value: string): string {
  return `survey|${sessionId}|${key}|${value}`;
}

function buildButtons(
  sessionId: string,
  key: SurveyQuestionKey | "fork" | "cancel",
  options: QuickReplyOption[]
): FlexComponent[] {
  return options.map((opt) => ({
    type: "button",
    style: "secondary",
    height: "sm",
    action: {
      type: "postback",
      label: opt.label,
      data: pb(sessionId, key, opt.value),
      displayText: opt.label,
    },
  }));
}

function questionBubble(
  sessionId: string,
  title: string,
  hint: string,
  key: SurveyQuestionKey,
  options: QuickReplyOption[]
): FlexBubble {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: title, weight: "bold", size: "lg", wrap: true },
        { type: "text", text: hint, size: "sm", color: "#888888", wrap: true, margin: "sm" },
      ],
      paddingAll: "md",
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: buildButtons(sessionId, key, options),
      paddingAll: "md",
    },
  };
}

const QUESTION_BUILDERS: Record<SurveyQuestionKey, (sessionId: string) => FlexBubble> = {
  destination: (id) =>
    questionBubble(
      id,
      "問題 1／8：目的地是哪裡？",
      "請直接在聊天室回覆目的地（例：京都、台北），或點選下方略過。",
      "destination",
      [{ label: "之後再決定", value: "skip" }]
    ),

  duration_days: (id) =>
    questionBubble(id, "問題 2／8：旅程幾天？", "選一個天數（也可以再改）。", "duration_days", [
      { label: "2 天", value: "2" },
      { label: "3 天", value: "3" },
      { label: "5 天", value: "5" },
      { label: "7 天", value: "7" },
      { label: "10 天", value: "10" },
      { label: "14 天", value: "14" },
    ]),

  party: (id) =>
    questionBubble(id, "問題 3／8：和誰一起？", "影響行程節奏與選擇。", "party", [
      { label: "一個人", value: "solo" },
      { label: "情侶", value: "couple" },
      { label: "家庭", value: "family" },
      { label: "朋友", value: "friends" },
    ]),

  party_size: (id) =>
    questionBubble(id, "問題 4／8：共幾人？", "用於估算交通與訂位。", "party_size", [
      { label: "1", value: "1" },
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "6", value: "6" },
      { label: "8+", value: "8" },
    ]),

  budget_tier: (id) =>
    questionBubble(id, "問題 5／8：預算？", "影響餐廳與住宿的選擇方向。", "budget_tier", [
      { label: "省錢（街頭美食 / 青旅）", value: "shoestring" },
      { label: "中等（一般餐館 / 三星）", value: "mid" },
      { label: "高級（精緻餐飲 / 四五星）", value: "luxury" },
    ]),

  vibe: (id) =>
    questionBubble(
      id,
      "問題 6／8：旅行的氛圍？",
      "點選一個主要風格（之後可以在 App 中加上更多）。",
      "vibe",
      [
        { label: "放鬆", value: "relaxed" },
        { label: "冒險", value: "adventure" },
        { label: "文化", value: "culture" },
        { label: "美食", value: "foodie" },
        { label: "夜生活", value: "nightlife" },
        { label: "自然", value: "nature" },
      ]
    ),

  // ski_prefs replaces the vibe step for Japan ski destinations. The 5
  // composite fields (level|terrain|onsen|family|non_ski_days) are too many
  // for a single LINE flex bubble, so we surface a handful of preset combos
  // that cover the common patterns; advanced users will still configure
  // generation details later in the web app.
  ski_prefs: (id) =>
    questionBubble(
      id,
      "問題 6／8：滑雪偏好？",
      "選一組最接近的組合（之後可在 App 微調）。",
      "ski_prefs",
      [
        { label: "🎿 初級・家庭路線", value: "beginner|groomers|nice_to_have|true|1" },
        { label: "🎿 中階・滑雪 + 溫泉", value: "intermediate|all_mountain|must_have|false|1" },
        { label: "🎿 中階・滑得爽", value: "intermediate|all_mountain|nice_to_have|false|0" },
        { label: "🏂 高階・追粉雪", value: "advanced|powder|nice_to_have|false|0" },
        { label: "🏔️ 專家・野雪挑戰", value: "expert|backcountry|skip|false|0" },
      ]
    ),

  pace: (id) =>
    questionBubble(id, "問題 7／8：行程節奏？", "每日要排幾個點。", "pace", [
      { label: "悠閒（每日 ≤3 站）", value: "chill" },
      { label: "均衡（每日 3–5 站）", value: "balanced" },
      { label: "緊湊（每日 5–6 站）", value: "packed" },
    ]),

  must_haves: (id) =>
    questionBubble(
      id,
      "問題 8／8：有什麼一定要的事？",
      "請直接在聊天室回覆（例：想吃壽司、想看夜景），或點選下方略過。",
      "must_haves",
      [{ label: "沒有特別的，略過", value: "skip" }]
    ),
};

export function buildQuestionBubble(
  sessionId: string,
  step: SurveyQuestionKey
): messagingApi.FlexContainer {
  return QUESTION_BUILDERS[step](sessionId);
}

export function buildPreviewBubble(
  sessionId: string,
  title: string,
  summary: string,
  durationDays: number,
  destination: string | null
): messagingApi.FlexContainer {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "草稿完成 ✨", weight: "bold", size: "md", color: "#00b900" },
        { type: "text", text: title, weight: "bold", size: "lg", wrap: true, margin: "sm" },
        {
          type: "text",
          text: `${destination ?? "未定地點"} · ${durationDays} 天`,
          size: "sm",
          color: "#888888",
          margin: "xs",
        },
        { type: "text", text: summary, size: "sm", wrap: true, margin: "md" },
      ],
      paddingAll: "md",
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#00b900",
          action: {
            type: "postback",
            label: "採用這份草稿",
            data: pb(sessionId, "fork", ""),
            displayText: "採用這份草稿",
          },
        },
        {
          type: "button",
          style: "secondary",
          action: {
            type: "postback",
            label: "放棄",
            data: pb(sessionId, "cancel", ""),
            displayText: "放棄",
          },
        },
      ],
      paddingAll: "md",
    },
  };
}
