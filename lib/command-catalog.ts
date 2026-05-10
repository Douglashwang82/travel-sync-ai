export type CommandCategory =
  | "trip"
  | "planning"
  | "decisions"
  | "readiness"
  | "operations"
  | "finance"
  | "privacy"
  | "support";

export type CommandCatalogEntry = {
  command: string;
  usage?: string;
  example: string;
  purpose: string;
  description: string;
  icon: string;
  category: CommandCategory;
  helpVisible?: boolean;
  rateLimitExempt?: boolean;
};

export const COMMAND_CATALOG = [
  {
    command: "/start",
    usage: "[destination?] [dates?]",
    example: "/start Osaka 7/15-7/20",
    purpose: "在 LINE 群組建立目前的旅程脈絡。",
    description:
      "開始新的旅程。目的地、日期與成員都可以之後再補齊。",
    icon: ">>",
    category: "trip",
  },
  {
    command: "/status",
    example: "/status",
    purpose: "查看目前的旅程看板。",
    description: "依待辦、投票中、已確認分類顯示旅程項目。",
    icon: "[]",
    category: "trip",
  },
  {
    command: "/itinerary",
    usage: "[date?]",
    example: "/itinerary 2026-07-15",
    purpose: "查看目前已確認的行程。",
    description:
      "顯示完整已確認行程；提供日期時只顯示當天安排。",
    icon: "CAL",
    category: "trip",
  },
  {
    command: "/add",
    usage: "[task]",
    example: "/add Renew passport",
    purpose: "新增需要完成的具體規劃任務。",
    description: "新增不需要投票的任務到旅程看板。",
    icon: "+",
    category: "planning",
  },
  {
    command: "/idea",
    usage: "[category?] [text]",
    example: "/idea restaurant Any ramen near Shinjuku",
    purpose: "記下一個還不需要承諾的旅遊靈感。",
    description:
      "把靈感放到靈感板，不會建立任務或投票。",
    icon: "*",
    category: "planning",
  },
  {
    command: "/ideas",
    example: "/ideas",
    purpose: "查看目前旅程的靈感清單。",
    description: "依分類列出尚未整理的旅遊靈感。",
    icon: "**",
    category: "planning",
  },
  {
    command: "/decide",
    usage: "[topic]",
    example: "/decide restaurant",
    purpose: "建立需要大家一起決定的主題。",
    description: "先建立決策項目，再加入選項並開始投票。",
    icon: "?",
    category: "decisions",
  },
  {
    command: "/option",
    usage: "[decision-topic] | [option-name]",
    example: "/option restaurant | Ramen Shop Osaka",
    purpose: "替既有決策加入候選選項。",
    description: "手動新增一個選項到決策項目。",
    icon: "|",
    category: "decisions",
  },
  {
    command: "/vote",
    usage: "[decision-topic]",
    example: "/vote restaurant",
    purpose: "針對既有決策開始投票。",
    description: "開啟或刷新決策投票，並送出投票操作卡片。",
    icon: "X",
    category: "decisions",
  },
  {
    command: "/nudge",
    example: "/nudge",
    purpose: "提醒群組處理卡住或停滯的事項。",
    description:
      "找出待投票、停滯任務、缺少訂位或其他阻塞事項，並送出優先提醒。",
    icon: "!",
    category: "operations",
  },
  {
    command: "/ready",
    example: "/ready",
    purpose: "檢查大家是否已準備好出發。",
    description:
      "彙整出發前日期、訂位、文件與阻塞事項的準備狀態。",
    icon: "OK",
    category: "readiness",
  },
  {
    command: "/ops",
    example: "/ops",
    purpose: "查看旅途中需要注意的執行事項。",
    description:
      "彙整近期安排、訂位缺口與突發事件等當日執行需求。",
    icon: "!!",
    category: "operations",
  },
  {
    command: "/incident",
    usage: "[what happened]",
    example: "/incident I lost my passport",
    purpose: "針對旅途中斷或突發事件啟動處理流程。",
    description: "分類事件、建立應對任務，並回傳可立即採取的處理步驟。",
    icon: "SOS",
    category: "operations",
  },
  {
    command: "/booked",
    usage: "[item name] [confirmation ref]",
    example: "/booked hotel AX-12345",
    purpose: "手動將已知旅程項目標記為已預訂。",
    description: "替已確認的旅程項目記錄訂位編號或連結。",
    icon: "#",
    category: "operations",
  },
  {
    command: "/confirm",
    usage: "[forwarded booking text]",
    example: "/confirm Booking confirmed! Ref AX-12345 Hotel Sunshine check-in July 15",
    purpose: "解析貼上的訂位文字，並標記對應項目為已預訂。",
    description:
      "使用 AI 從轉貼的確認信或訂位內容中擷取訂位資訊。",
    icon: "@",
    category: "operations",
  },
  {
    command: "/docs",
    usage: "add [type] [label?] [expires YYYY-MM-DD?] | list",
    example: "/docs add passport expires 2028-03-15",
    purpose: "管理旅遊文件準備狀態。",
    description:
      "記錄並檢查護照、簽證、保險等文件狀態與到期提醒。",
    icon: "ID",
    category: "readiness",
  },
  {
    command: "/pack",
    usage: "add [category?] [item] | list | check [#]",
    example: "/pack add clothing rain jacket",
    purpose: "管理群組打包清單。",
    description:
      "新增、列出並勾選文件、衣物、盥洗、電子用品、安全與一般物品。",
    icon: "PK",
    category: "readiness",
  },
  {
    command: "/budget",
    usage: "[amount] [currency?]",
    example: "/budget 50000 JPY",
    purpose: "設定旅程預算上限。",
    description: "設定或更新旅程總預算；幣別預設為 TWD。",
    icon: "$",
    category: "finance",
  },
  {
    command: "/exp",
    usage: "[amount] [description] [for @name1 @name2 | for all]",
    example: "/exp 1200 dinner for @Alice @Bob",
    purpose: "記錄已支付費用並分帳。",
    description: "記錄付款，並分攤給指定成員或整個群組。",
    icon: "$+",
    category: "finance",
  },
  {
    command: "/exp-summary",
    example: "/exp-summary",
    purpose: "查看餘額、結算與預算進度。",
    description: "顯示誰該付誰、最少轉帳建議，以及可用時的預算使用狀況。",
    icon: "$=",
    category: "finance",
  },
  {
    command: "/ask",
    usage: "[question]",
    example: "/ask what hotels have we confirmed?",
    purpose: "根據目前旅程狀態回答唯讀問題。",
    description:
      "使用看板、訂位、文件、費用與靈感資料回答問題，不會更改資料。",
    icon: "AI",
    category: "support",
  },
  {
    command: "/share",
    usage: "[url]",
    example: "/share https://booking.com/hotel/xyz",
    purpose: "把旅遊連結保存為旅程知識。",
    description: "保存飯店、餐廳、航班或活動連結，供之後推薦時使用。",
    icon: "->",
    category: "planning",
  },
  {
    command: "/recommend",
    usage: "[restaurant|hotel|activity] [keywords?]",
    example: "/recommend restaurant",
    purpose: "優先從群組記住的地點中推薦。",
    description: "先根據群組聊天與分享連結推薦地點，再考慮外部搜尋。",
    icon: "~",
    category: "planning",
  },
  {
    command: "/track",
    usage: "[add <url>|run]",
    example: "/track add https://www.timeout.com/tokyo restaurant",
    purpose: "追蹤網站或 RSS 來源的旅遊更新。",
    description: "追蹤來源，提供每日旅遊與餐廳相關更新。",
    icon: "RSS",
    category: "support",
  },
  {
    command: "/cancel",
    example: "/cancel",
    purpose: "取消目前進行中的旅程。",
    description: "取消目前進行中的旅程。",
    icon: "--",
    category: "trip",
  },
  {
    command: "/complete",
    example: "/complete",
    purpose: "將目前旅程標記為完成。",
    description: "結束旅程，並送出最終結算與回饋提示。",
    icon: "END",
    category: "trip",
  },
  {
    command: "/delete-my-data",
    example: "/delete-my-data",
    purpose: "要求刪除呼叫者的個人資料。",
    description: "替發出指令的 LINE 使用者啟動個人資料刪除流程。",
    icon: "DEL",
    category: "privacy",
    helpVisible: false,
    rateLimitExempt: true,
  },
  {
    command: "/optout",
    example: "/optout",
    purpose: "停用你的訊息解析。",
    description: "停止 TravelSync 解析你的訊息作為旅程規劃資料。",
    icon: "OFF",
    category: "privacy",
    rateLimitExempt: true,
  },
  {
    command: "/optin",
    example: "/optin",
    purpose: "重新啟用你的訊息解析。",
    description: "在退出後重新允許 TravelSync 解析你的訊息。",
    icon: "ON",
    category: "privacy",
    rateLimitExempt: true,
  },
  {
    command: "/help",
    example: "/help",
    purpose: "顯示指令清單。",
    description: "顯示可用指令與範例。",
    icon: "?",
    category: "support",
    rateLimitExempt: true,
  },
] as const satisfies CommandCatalogEntry[];

export type CommandName = (typeof COMMAND_CATALOG)[number]["command"];

export const PUBLIC_COMMAND_CATALOG: readonly CommandCatalogEntry[] = COMMAND_CATALOG.filter(
  (entry: CommandCatalogEntry) => entry.helpVisible !== false
);

export function getCommandUsage(entry: CommandCatalogEntry): string {
  return entry.usage ? `${entry.command} ${entry.usage}` : entry.command;
}

export function getCommandCatalogEntry(command: string): CommandCatalogEntry | undefined {
  return COMMAND_CATALOG.find((entry) => entry.command === command);
}

export function buildBotHelpText(): string {
  const lines: string[] = ["TravelSync AI 指令清單", ""];

  for (const entry of PUBLIC_COMMAND_CATALOG) {
    lines.push(getCommandUsage(entry));
    lines.push(`  ${entry.description}`);
    lines.push(`  範例：${entry.example}`);
    lines.push("");
  }

  lines.push("輸入 /optout 可停止我解析你的訊息。");

  return lines.join("\n");
}
