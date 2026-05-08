export const APP_PACK_CATEGORIES = [
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "health",
  "safety",
  "general",
] as const;

export type AppPackCategory = (typeof APP_PACK_CATEGORIES)[number];
export type AppPackScope = "group" | "mine";

export interface AppGroupPackItem {
  id: string;
  label: string;
  category: AppPackCategory;
  addedBy: string | null;
  addedByName: string | null;
  createdAt: string;
  isPackedByMe: boolean;
  packedCount: number;
  canDelete: boolean;
}

export interface AppPersonalPackItem {
  id: string;
  label: string;
  category: AppPackCategory;
  isPacked: boolean;
  packedAt: string | null;
  position: number;
  createdAt: string;
}

export interface AppPackResponse {
  trip: {
    id: string;
    destinationName: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  currentUser: {
    lineUserId: string;
    role: "organizer" | "member";
  };
  groupItems: AppGroupPackItem[];
  personalItems: AppPersonalPackItem[];
  groupPackedCount: number;
  personalPackedCount: number;
}
