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
}

export interface TripIdeasResponse {
  ideas: TripIdea[];
}
