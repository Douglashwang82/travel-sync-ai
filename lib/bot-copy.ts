export const BOT_LANGUAGE_RULE =
  "預設使用繁體中文回覆。只有在使用者明確要求其他語言時才切換；專有名詞、地名、訂位代碼、金額與 URL 保留原文。";

export const BOT_COPY = {
  unknownCommand: "我看不懂這個指令。輸入 /help 可以查看可用指令。",
  groupRateLimited: "指令太頻繁了，請稍等一下再試。",
  userRateLimited: "你送出指令的速度太快了，請稍微放慢一點。",
  viewLink: (url: string) => `查看：${url}`,
  viewLabel: "查看",
  noActiveTrip: "目前沒有進行中的旅程。請先使用 /start 建立旅程。",
  noActiveTripWithStart: "目前沒有進行中的旅程。請先使用 /start [目的地] [日期] 建立旅程。",
  temporaryUnavailable: "我暫時無法回覆，請稍後再試。",
  genericError: "抱歉，發生了一點問題，請再試一次。",
} as const;
