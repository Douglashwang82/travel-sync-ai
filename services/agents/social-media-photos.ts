import { z } from "zod";
import { generateText, GeminiUnavailableError } from "@/lib/gemini";
import {
  searchSocialPhotos,
  SocialPhotosUnavailableError,
  type SocialPhoto,
  type SocialPlatform,
} from "@/lib/social-photos";
import type { AgentDefinition, AgentRunContext, AgentRunResult } from "./types";

/**
 * Platform combinations the user can pick. The form only renders single-select
 * `select` fields, so we encode the multi-platform choice as one of three
 * fixed combos rather than introducing a new `multiselect` field type.
 */
const PLATFORM_CHOICE = ["instagram", "tiktok", "both"] as const;
type PlatformChoice = (typeof PLATFORM_CHOICE)[number];

const ConfigSchema = z.object({
  targetName: z.string().min(2).max(120),
  targetType: z.enum(["resort", "restaurant", "cafe", "attraction", "other"]).default("resort"),
  platforms: z.enum(PLATFORM_CHOICE).default("both"),
  maxPhotos: z.number().int().min(1).max(20).default(9),
});

type SocialPhotosConfig = z.infer<typeof ConfigSchema>;

function expandPlatforms(choice: PlatformChoice): SocialPlatform[] {
  if (choice === "instagram") return ["instagram"];
  if (choice === "tiktok") return ["tiktok"];
  return ["instagram", "tiktok"];
}

const TARGET_TYPE_LABEL: Record<SocialPhotosConfig["targetType"], string> = {
  resort: "度假村",
  restaurant: "餐廳",
  cafe: "咖啡廳",
  attraction: "景點",
  other: "目標",
};

async function summarize(
  config: SocialPhotosConfig,
  photos: SocialPhoto[],
): Promise<string> {
  const typeLabel = TARGET_TYPE_LABEL[config.targetType];
  if (photos.length === 0) {
    return `沒有從社群平台找到「${config.targetName}」的公開照片。`;
  }
  const fallback = `已從社群平台找到 ${photos.length} 張「${config.targetName}」的相關照片(${typeLabel}),可作為決策參考。`;
  try {
    const captions = photos
      .map((p) => p.title)
      .filter((t) => t.length > 0)
      .slice(0, 8);
    if (captions.length === 0) return fallback;
    const text = await generateText(
      "你是一位簡潔的旅遊圖像觀察助手。根據社群貼文標題,用 1-2 句繁體中文點出這個地點的整體氛圍或亮點(例如海景、室內裝潢、菜色等)。不要使用表情符號,也不要寒暄。",
      JSON.stringify({
        target: config.targetName,
        type: typeLabel,
        captions,
      }),
    );
    return text.trim() || fallback;
  } catch (err) {
    if (err instanceof GeminiUnavailableError) return fallback;
    throw err;
  }
}

async function run(ctx: AgentRunContext): Promise<AgentRunResult> {
  const config = ConfigSchema.parse(ctx.config);
  const platforms = expandPlatforms(config.platforms);

  let photos: SocialPhoto[] = [];
  let providerError: string | null = null;

  try {
    photos = await searchSocialPhotos({
      target: config.targetName,
      platforms,
      limit: config.maxPhotos,
    });
  } catch (err) {
    if (err instanceof SocialPhotosUnavailableError) {
      providerError = err.message;
    } else {
      throw err;
    }
  }

  const summary = providerError
    ? `社群照片來源目前無法使用(${providerError})。請稍後再試。`
    : await summarize(config, photos);

  const platformCounts = photos.reduce<Record<SocialPlatform, number>>(
    (acc, p) => {
      acc[p.platform] = (acc[p.platform] ?? 0) + 1;
      return acc;
    },
    { instagram: 0, tiktok: 0 },
  );

  return {
    outputKind: "list",
    output: {
      targetName: config.targetName,
      targetType: config.targetType,
      targetTypeLabel: TARGET_TYPE_LABEL[config.targetType],
      platforms,
      photos,
      photoCount: photos.length,
      platformCounts,
      summary,
      providerError,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const socialMediaPhotos: AgentDefinition<SocialPhotosConfig> = {
  type: "social_media_photos",
  label: "社群照片探索",
  description:
    "從 Instagram / TikTok 公開貼文搜尋特定目標(度假村、餐廳、景點等)的照片,協助旅伴一起評估。需要設定 SERPAPI_KEY。",
  icon: "📸",
  mode: "assist",
  defaultFrequencyHours: 24,
  configSchema: ConfigSchema,
  defaultConfig: {
    targetName: "",
    targetType: "resort",
    platforms: "both",
    maxPhotos: 9,
  } as SocialPhotosConfig,
  configFields: [
    {
      name: "targetName",
      label: "目標名稱",
      type: "text",
      placeholder: "例如:Aman Tokyo",
      required: true,
    },
    {
      name: "targetType",
      label: "類型",
      type: "select",
      options: [
        { value: "resort", label: "度假村 / 飯店" },
        { value: "restaurant", label: "餐廳" },
        { value: "cafe", label: "咖啡廳" },
        { value: "attraction", label: "景點" },
        { value: "other", label: "其他" },
      ],
    },
    {
      name: "platforms",
      label: "來源平台",
      type: "select",
      options: [
        { value: "both", label: "Instagram + TikTok" },
        { value: "instagram", label: "僅 Instagram" },
        { value: "tiktok", label: "僅 TikTok" },
      ],
    },
    {
      name: "maxPhotos",
      label: "照片數上限",
      type: "number",
      placeholder: "9",
      min: 1,
      max: 20,
    },
  ],
  run,
};
