import type { ItemType } from "@/lib/types";

export type IncidentType =
  | "flight_delay"
  | "missed_meetup"
  | "late_arrival"
  | "lost_document"
  | "lost_baggage"
  | "illness"
  | "venue_closure"
  | "weather_disruption";

export interface IncidentFollowUpTask {
  title: string;
  itemType: ItemType;
}

export interface IncidentPlaybook {
  incidentType: IncidentType;
  title: string;
  severity: "medium" | "high" | "critical";
  summary: string;
  immediateActions: string[];
  coordinatorActions: string[];
  verifiedContacts: string[];
  followUpTasks: IncidentFollowUpTask[];
  disclaimer: string;
}

export interface IncidentResolution {
  matched: boolean;
  matchConfidence: "high" | "medium" | "low";
  normalizedQuery: string;
  playbook: IncidentPlaybook | null;
  suggestions: IncidentType[];
}

const INCIDENT_ALIASES: Record<IncidentType, string[]> = {
  flight_delay: [
    "flight delay",
    "delayed flight",
    "missed flight",
    "flight cancelled",
    "flight canceled",
    "gate change",
    "plane delay",
    "航班延誤",
    "班機延誤",
    "錯過飛機",
    "趕不上飛機",
    "改閘口",
  ],
  missed_meetup: [
    "missed meetup",
    "can't find group",
    "cannot find group",
    "where are you",
    "lost the group",
    "找不到大家",
    "走散",
    "找不到集合點",
  ],
  late_arrival: [
    "running late",
    "late arrival",
    "arrive late",
    "miss check in",
    "will be late",
    "我會晚到",
    "晚點到",
    "來不及",
  ],
  lost_document: [
    "lost passport",
    "missing passport",
    "lost visa",
    "passport stolen",
    "護照不見",
    "護照遺失",
    "簽證不見",
    "文件遺失",
  ],
  lost_baggage: [
    "lost bag",
    "lost baggage",
    "missing luggage",
    "baggage delay",
    "行李不見",
    "行李遺失",
    "找不到行李",
  ],
  illness: [
    "sick",
    "ill",
    "fever",
    "hospital",
    "food poisoning",
    "不舒服",
    "生病",
    "發燒",
    "肚子痛",
  ],
  venue_closure: [
    "closed venue",
    "restaurant closed",
    "hotel issue",
    "reservation canceled",
    "店沒開",
    "臨時休息",
    "預約被取消",
    "關門",
  ],
  weather_disruption: [
    "bad weather",
    "rain cancel",
    "typhoon",
    "storm",
    "snow delay",
    "天氣不好",
    "颱風",
    "暴雨",
    "下雪延誤",
  ],
};

const PLAYBOOKS: Record<IncidentType, IncidentPlaybook> = {
  flight_delay: {
    incidentType: "flight_delay",
    title: "班機延誤或錯過班機",
    severity: "critical",
    summary:
      "先穩定出發計畫：確認最新航班狀態、保住訂位，並重新對齊機場時程，再調整當天其他安排。",
    immediateActions: [
      "用航空公司 App、機場看板或官方客服確認最新狀態。",
      "確認報到、改票或登機門指示是否有變動。",
      "在最新出發時間確認前，暫緩前往機場的非必要行程。",
    ],
    coordinatorActions: [
      "用一則清楚的訊息更新群組，並告知下一次回報時間。",
      "若需要改票或保護訂位，致電航空公司或前往櫃檯處理。",
      "檢視可能受影響的後續預訂，特別是機場接送或晚到的飯店入住。",
    ],
    verifiedContacts: [
      "航空公司官方 App 或客服",
      "機場出境看板或服務台",
      "若抵達時間會變動，請聯絡飯店櫃檯",
    ],
    followUpTasks: [
      { title: "確認更新後的航班狀態", itemType: "flight" },
      { title: "通知飯店或接送方延後抵達", itemType: "transport" },
    ],
    disclaimer:
      "改票、登機門和出發決定請以官方航空公司與機場通知為最終依據。",
  },
  missed_meetup: {
    incidentType: "missed_meetup",
    title: "會合失敗或走散",
    severity: "high",
    summary:
      "迅速降低混亂：暫停原計畫、確認一個集合點，並盡量用最少訊息溝通。",
    immediateActions: [
      "停下移動，分享你的精確位置或最近的地標。",
      "用一個共識的集合點，避免多個提議並存。",
      "確認群組是要等候、分開行動，還是繼續原計畫。",
    ],
    coordinatorActions: [
      "指定一位協調者統籌會合事宜。",
      "公告唯一確認的集合點與預估抵達時間。",
      "如果無法及時會合，再設一個之後的備用會合時間。",
    ],
    verifiedContacts: [
      "目前所在場所的櫃檯或服務台",
      "若相關，可詢問交通站的服務台",
    ],
    followUpTasks: [
      { title: "確認備用會合點", itemType: "transport" },
    ],
    disclaimer:
      "若地標不清楚或網路不穩，請優先尋求現場服務人員協助。",
  },
  late_arrival: {
    incidentType: "late_arrival",
    title: "遲到",
    severity: "high",
    summary:
      "先保住預訂，再調整抵達計畫，讓其他人清楚要等候還是繼續行程。",
    immediateActions: [
      "盡可能誠實地預估新的抵達時間。",
      "確認飯店入住、餐廳或行程時間是否會受影響。",
      "告訴群組你需要他們等候、調整順序，還是先行動。",
    ],
    coordinatorActions: [
      "通知受影響的飯店、店家或交通服務新的抵達時間。",
      "重新安排有嚴格截止時間的預訂。",
      "用一個確認過的新行程更新群組。",
    ],
    verifiedContacts: [
      "飯店或店家直接聯絡方式",
      "若涉及交通，可聯絡接送司機或訂位客服",
    ],
    followUpTasks: [
      { title: "確認修正後的抵達時間", itemType: "transport" },
      { title: "通知受影響的預訂遲到狀況", itemType: "other" },
    ],
    disclaimer:
      "各家預訂的截止規則不同，請直接向官方店家或服務商確認。",
  },
  lost_document: {
    incidentType: "lost_document",
    title: "護照或旅遊文件遺失",
    severity: "critical",
    summary:
      "證件遺失視為高優先事件。先確保旅客本身安全，再聯絡官方單位與所屬使領館。",
    immediateActions: [
      "確認證件確實遺失，並只回到最後幾個安全的地點查找。",
      "在繼續尋找前，先保護好旅客本人與其餘貴重物品。",
      "若有，準備好證件影本或照片。",
    ],
    coordinatorActions: [
      "若懷疑遭竊或需要報案，請聯絡當地警方。",
      "聯絡旅客所屬使領館，了解緊急旅行證件流程。",
      "檢視是否需要調整即將發生的航班、過境或飯店入住。",
    ],
    verifiedContacts: [
      "當地警方非緊急或竊盜報案管道",
      "旅客所屬使領館",
      "若影響後續行程，可聯絡航空公司客服",
    ],
    followUpTasks: [
      { title: "聯絡使領館協助辦理證件", itemType: "other" },
      { title: "檢視即將到來的過境或航班影響", itemType: "flight" },
    ],
    disclaimer:
      "法律與旅行證件相關決定，請以使領館、警方和航空公司的官方指示為準。",
  },
  lost_baggage: {
    incidentType: "lost_baggage",
    title: "行李遺失或延誤",
    severity: "medium",
    summary:
      "趁還在機場流程中盡快通報，並在離開前記下所有參考號碼。",
    immediateActions: [
      "再檢查一次行李轉盤、超大件行李區與行李顯示螢幕。",
      "離開機場前先向航空公司或行李櫃檯通報。",
      "保存行李遺失參考號與配送指示。",
    ],
    coordinatorActions: [
      "把行李參考號分享給群組。",
      "若行李延誤，確認要送達的地址。",
      "若需要購買必要物品，調整第一天的行程。",
    ],
    verifiedContacts: [
      "航空公司行李服務櫃檯",
      "機場行李協助櫃檯",
    ],
    followUpTasks: [
      { title: "保存行李遺失參考號", itemType: "flight" },
      { title: "確認行李配送地址", itemType: "transport" },
    ],
    disclaimer:
      "行李狀態請以航空公司行李參考號與服務櫃檯資訊為準。",
  },
  illness: {
    incidentType: "illness",
    title: "生病或醫療狀況",
    severity: "critical",
    summary:
      "健康優先。先判斷是「休息觀察」還是「需要就醫」，並立刻簡化群組的行程。",
    immediateActions: [
      "評估症狀是否需要立即就醫。",
      "停止任何耗費體力的活動，把患者安置到安全的休息地點。",
      "若有，查看保險細節與所需藥物。",
    ],
    coordinatorActions: [
      "症狀嚴重時，立即聯絡當地緊急服務或醫療單位。",
      "必要時指派一位同伴陪伴患者。",
      "調整或取消當日行程，讓其他成員有清楚的預期。",
    ],
    verifiedContacts: [
      "當地緊急服務",
      "旅遊保險緊急支援",
      "鄰近的診所、醫院或飯店櫃檯協助",
    ],
    followUpTasks: [
      { title: "確認醫療支援計畫", itemType: "other" },
      { title: "依健康狀況調整今日行程", itemType: "activity" },
    ],
    disclaimer:
      "緊急症狀請直接聯絡官方緊急或醫療服務，本流程僅供協調參考。",
  },
  venue_closure: {
    incidentType: "venue_closure",
    title: "店家公休或預約問題",
    severity: "medium",
    summary:
      "先確認公休或取消，再決定要修復原計畫，還是改用備案。",
    immediateActions: [
      "向官方店家或訂位來源確認公休或取消狀況。",
      "確認是否有其他時段或附近替代方案。",
      "告訴群組是要原地等候，還是切換到備案。",
    ],
    coordinatorActions: [
      "向店家或訂位服務商了解改期或退款選項。",
      "選一個交通影響最小的最佳備案。",
      "用一個確認後的替代方案更新群組。",
    ],
    verifiedContacts: [
      "店家官方電話或訂位頁面",
      "若是透過平台訂位，請聯絡 OTA 或訂位平台客服",
    ],
    followUpTasks: [
      { title: "確認備案場地或預約", itemType: "activity" },
    ],
    disclaimer:
      "退款、預約狀態與政策細節，請以原始訂位來源為準。",
  },
  weather_disruption: {
    incidentType: "weather_disruption",
    title: "天氣造成的行程影響",
    severity: "high",
    summary:
      "優先考量安全與交通影響，再把當日行程精簡到最小可行版本。",
    immediateActions: [
      "出發前先查看官方氣象與交通公告。",
      "決定要延後、改道，還是原地待命最安全。",
      "保護任何可能錯過的時效性預訂。",
    ],
    coordinatorActions: [
      "選擇一個保守的群組計畫，清楚地通知一次。",
      "確認交通、行程或戶外預訂是否仍然運作。",
      "若情況持續，準備好室內或低風險的備案。",
    ],
    verifiedContacts: [
      "官方氣象服務或地方政府警示",
      "鐵路、航空或交通業者狀態頁面",
      "飯店櫃檯了解當地狀況與避難建議",
    ],
    followUpTasks: [
      { title: "確認天氣對交通的影響", itemType: "transport" },
      { title: "選擇今日的低風險備案", itemType: "activity" },
    ],
    disclaimer:
      "安全狀況改變時，以官方氣象與交通公告為準。",
  },
};

export function resolveIncident(query: string): IncidentResolution {
  const normalizedQuery = normalizeIncidentQuery(query);
  if (!normalizedQuery) {
    return {
      matched: false,
      matchConfidence: "low",
      normalizedQuery,
      playbook: null,
      suggestions: ["flight_delay", "missed_meetup", "lost_document", "illness"],
    };
  }

  const scored = (Object.keys(INCIDENT_ALIASES) as IncidentType[])
    .map((incidentType) => ({
      incidentType,
      score: scoreIncidentMatch(normalizedQuery, INCIDENT_ALIASES[incidentType]),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) {
    return {
      matched: false,
      matchConfidence: "low",
      normalizedQuery,
      playbook: null,
      suggestions: scored.slice(0, 4).map((entry) => entry.incidentType),
    };
  }

  return {
    matched: true,
    matchConfidence: best.score >= 3 ? "high" : "medium",
    normalizedQuery,
    playbook: PLAYBOOKS[best.incidentType],
    suggestions: scored.slice(1, 4).map((entry) => entry.incidentType),
  };
}

export function renderIncidentChatMessage(playbook: IncidentPlaybook): string {
  const lines = [
    `事件處理流程：${playbook.title}`,
    "",
    playbook.summary,
    "",
    "立即執行：",
    ...playbook.immediateActions.map((action) => `- ${action}`),
    "",
    "協調者步驟：",
    ...playbook.coordinatorActions.map((action) => `- ${action}`),
    "",
    "可信聯絡管道：",
    ...playbook.verifiedContacts.map((contact) => `- ${contact}`),
    "",
    `重要提醒：${playbook.disclaimer}`,
  ];

  return lines.join("\n");
}

function normalizeIncidentQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .trim();
}

function scoreIncidentMatch(query: string, aliases: string[]): number {
  let score = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeIncidentQuery(alias);
    if (!normalizedAlias) continue;
    if (query === normalizedAlias) score += 4;
    else if (query.includes(normalizedAlias)) score += 3;
    else if (normalizedAlias.includes(query)) score += 1;
  }
  return score;
}
