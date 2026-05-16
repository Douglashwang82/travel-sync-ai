export const IDEA_CATEGORIES = [
  "destination",
  "hotel",
  "activity",
  "restaurant",
  "general",
] as const;

export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

export interface TripIdea {
  id: string;
  category: IdeaCategory;
  text: string;
  submittedBy: string;
  displayName: string | null;
  promoted: boolean;
  promotedItemId: string | null;
  createdAt: string;
  isMine: boolean;
  /** Set when the idea was authored by an agent (e.g. "itinerary_drafter"). */
  sourceAgent: string | null;
  /** Soft FK to the agent run that produced this idea. */
  sourceRunId: string | null;
}

export interface TripIdeasResponse {
  ideas: TripIdea[];
}
