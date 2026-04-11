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
    title: "Flight Delay or Missed Flight",
    severity: "critical",
    summary:
      "Stabilize the group's departure plan first: confirm the latest carrier status, protect the booking, and realign airport timing before changing the rest of the day.",
    immediateActions: [
      "Confirm the latest status using the airline app, airport board, or official airline support.",
      "Check whether check-in, rebooking, or gate instructions have changed.",
      "Pause non-essential travel to the airport until the latest departure time is confirmed.",
    ],
    coordinatorActions: [
      "Update the group with one clear status message and the next check-in time.",
      "Call the airline or go to the airline desk if rebooking or protection is needed.",
      "Review downstream reservations that may be affected, especially airport transfer or late check-in.",
    ],
    verifiedContacts: [
      "Airline official app or customer support",
      "Airport departures board or help desk",
      "Hotel front desk if arrival time will change",
    ],
    followUpTasks: [
      { title: "Confirm updated flight status", itemType: "flight" },
      { title: "Notify hotel or transfer about delayed arrival", itemType: "transport" },
    ],
    disclaimer:
      "Use official airline and airport channels as the final authority for rebooking, gate, and departure decisions.",
  },
  missed_meetup: {
    incidentType: "missed_meetup",
    title: "Missed Meetup or Lost the Group",
    severity: "high",
    summary:
      "Reduce confusion quickly by freezing the plan, confirming one meeting point, and using the smallest number of messages possible.",
    immediateActions: [
      "Stop moving and share your exact location or nearest landmark.",
      "Use one agreed meeting point instead of multiple suggestions.",
      "Confirm whether the group should wait, split, or continue the original plan.",
    ],
    coordinatorActions: [
      "Nominate one person to coordinate the regrouping.",
      "Post a single confirmed meetup point and arrival estimate.",
      "If the group cannot regroup in time, set a backup rendezvous later in the day.",
    ],
    verifiedContacts: [
      "Current venue front desk or staff desk",
      "Transit station information desk if relevant",
    ],
    followUpTasks: [
      { title: "Confirm backup meetup point", itemType: "transport" },
    ],
    disclaimer:
      "Use staff help desks or venue staff when landmarks are unclear or connectivity is weak.",
  },
  late_arrival: {
    incidentType: "late_arrival",
    title: "Late Arrival",
    severity: "high",
    summary:
      "Protect the reservation first, then adjust the arrival plan so the rest of the group knows whether to wait or proceed.",
    immediateActions: [
      "Estimate the new arrival time as realistically as possible.",
      "Check whether hotel check-in, restaurant, or tour timing will be affected.",
      "Tell the group whether you need them to wait, reorder plans, or continue without you.",
    ],
    coordinatorActions: [
      "Notify the affected hotel, host, or transport provider about the revised arrival time.",
      "Re-sequence any bookings that have tight cutoff times.",
      "Update the group with one confirmed revised schedule.",
    ],
    verifiedContacts: [
      "Hotel or host direct contact",
      "Transfer driver or booking support if transport is involved",
    ],
    followUpTasks: [
      { title: "Confirm revised arrival time", itemType: "transport" },
      { title: "Notify affected reservation about late arrival", itemType: "other" },
    ],
    disclaimer:
      "Reservation cutoff rules vary, so confirm with the official property or provider directly.",
  },
  lost_document: {
    incidentType: "lost_document",
    title: "Lost Passport or Travel Document",
    severity: "critical",
    summary:
      "Treat missing identity documents as a priority incident. Secure the traveler first, then contact official authorities and the relevant embassy or consulate.",
    immediateActions: [
      "Confirm the document is truly missing and retrace only the last safe locations.",
      "Secure the traveler and remaining valuables before continuing any search.",
      "Prepare a copy or photo of the document if one exists.",
    ],
    coordinatorActions: [
      "Contact local police if theft is suspected or a report is required.",
      "Contact the traveler's embassy or consulate for emergency travel document guidance.",
      "Review whether imminent flights, border crossings, or hotel check-in need to be changed.",
    ],
    verifiedContacts: [
      "Local police non-emergency or theft reporting channel",
      "Traveler's embassy or consulate",
      "Airline support if onward travel is affected",
    ],
    followUpTasks: [
      { title: "Contact embassy or consulate for document support", itemType: "other" },
      { title: "Review upcoming border or flight impact", itemType: "flight" },
    ],
    disclaimer:
      "Embassy, consulate, police, and airline instructions override this playbook for legal and travel-document decisions.",
  },
  lost_baggage: {
    incidentType: "lost_baggage",
    title: "Lost or Delayed Baggage",
    severity: "medium",
    summary:
      "Report the baggage issue quickly while you are still in the airport process, then capture every reference number before leaving.",
    immediateActions: [
      "Check the carousel, oversized baggage area, and baggage screens one more time.",
      "Report the issue to the airline or baggage desk before leaving the airport.",
      "Save the baggage claim reference and any delivery instructions.",
    ],
    coordinatorActions: [
      "Share the baggage reference number with the group.",
      "Confirm where the bag should be delivered if delayed.",
      "Adjust the first-day plan if essential items need to be purchased.",
    ],
    verifiedContacts: [
      "Airline baggage service desk",
      "Airport baggage support desk",
    ],
    followUpTasks: [
      { title: "Save baggage claim reference", itemType: "flight" },
      { title: "Confirm baggage delivery address", itemType: "transport" },
    ],
    disclaimer:
      "The airline's baggage reference and service desk are the authoritative source for claim status.",
  },
  illness: {
    incidentType: "illness",
    title: "Illness or Medical Issue",
    severity: "critical",
    summary:
      "Health comes first. Decide whether this is a rest-and-monitor situation or a medical-care situation, then simplify the group's plan immediately.",
    immediateActions: [
      "Assess whether symptoms require urgent medical attention right now.",
      "Stop physically demanding activities and move the traveler to a safe resting place.",
      "Check insurance details and medication needs if available.",
    ],
    coordinatorActions: [
      "If symptoms are serious, contact local emergency services or a medical provider immediately.",
      "Assign one companion to stay with the affected traveler if needed.",
      "Adjust or cancel day plans so the rest of the group has a clear expectation.",
    ],
    verifiedContacts: [
      "Local emergency services",
      "Travel insurance emergency support",
      "Nearest clinic, hospital, or hotel front desk for local guidance",
    ],
    followUpTasks: [
      { title: "Confirm medical support plan", itemType: "other" },
      { title: "Adjust today's itinerary for health issue", itemType: "activity" },
    ],
    disclaimer:
      "Urgent symptoms should go straight to official emergency or medical providers. This playbook is organizational guidance only.",
  },
  venue_closure: {
    incidentType: "venue_closure",
    title: "Venue Closure or Reservation Problem",
    severity: "medium",
    summary:
      "Confirm the closure or cancellation, then decide quickly whether to recover the plan or swap in a backup.",
    immediateActions: [
      "Verify the closure or cancellation with the official venue or booking source.",
      "Check whether there is an alternate time slot or nearby substitute.",
      "Tell the group whether to hold position or move to the backup plan.",
    ],
    coordinatorActions: [
      "Contact the venue or booking provider about rebooking or refund options.",
      "Select the best fallback option with the least travel disruption.",
      "Update the group with one confirmed replacement plan.",
    ],
    verifiedContacts: [
      "Venue official phone or booking page",
      "OTA or reservation platform support if booked through a platform",
    ],
    followUpTasks: [
      { title: "Confirm fallback venue or reservation", itemType: "activity" },
    ],
    disclaimer:
      "Use the original booking source as the authority for refunds, reservation status, and policy details.",
  },
  weather_disruption: {
    incidentType: "weather_disruption",
    title: "Weather Disruption",
    severity: "high",
    summary:
      "Prioritize safety and transport impact first, then reduce the day's plan to the minimum viable version.",
    immediateActions: [
      "Check official weather and transport advisories before moving.",
      "Decide whether the safest option is to delay, reroute, or stay put.",
      "Protect any time-sensitive bookings that may be missed.",
    ],
    coordinatorActions: [
      "Choose a conservative group plan and communicate it clearly once.",
      "Confirm whether transport, tours, or outdoor reservations are still operating.",
      "Prepare an indoor or low-risk fallback plan if the disruption continues.",
    ],
    verifiedContacts: [
      "Official weather service or local authority alerts",
      "Rail, airline, or transport operator status pages",
      "Hotel front desk for local conditions and shelter guidance",
    ],
    followUpTasks: [
      { title: "Confirm transport impact from weather", itemType: "transport" },
      { title: "Choose low-risk fallback plan for today", itemType: "activity" },
    ],
    disclaimer:
      "Official weather and transport advisories override this playbook when safety conditions change.",
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
    `Incident Playbook: ${playbook.title}`,
    "",
    playbook.summary,
    "",
    "Do now:",
    ...playbook.immediateActions.map((action) => `- ${action}`),
    "",
    "Coordinator steps:",
    ...playbook.coordinatorActions.map((action) => `- ${action}`),
    "",
    "Verified contacts:",
    ...playbook.verifiedContacts.map((contact) => `- ${contact}`),
    "",
    `Important: ${playbook.disclaimer}`,
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
