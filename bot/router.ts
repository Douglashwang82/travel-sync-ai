import * as line from "@line/bot-sdk";
import { replyFlex, replyText, pushFlex, pushText } from "@/lib/line";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildCommandPageUrl, isLinkableCommand } from "@/lib/command-pages";
import { createAdminClient } from "@/lib/db";
import { BOT_COPY } from "@/lib/bot-copy";
import { COMMAND_ROUTE_MAP, RATE_LIMIT_EXEMPT_COMMANDS } from "./command-registry";

export interface CommandContext {
  lineGroupId: string;
  dbGroupId: string | null;
  userId: string | undefined;
  replyToken: string | undefined;
}

export interface FlexReply {
  type: "flex";
  altText: string;
  contents: line.messagingApi.FlexContainer;
}

export type ReplyPayload = string | FlexReply;
export type Reply = (message: ReplyPayload) => Promise<void>;

/**
 * Parse and route a slash command message to the appropriate handler.
 */
export async function routeCommand(
  text: string,
  ctx: CommandContext
): Promise<void> {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  // Lazily resolve the current trip id once per command, so we can append
  // a deep link to every reply without re-querying.
  let cachedPageUrl: string | null | undefined;
  const resolvePageUrl = async (): Promise<string | null> => {
    if (cachedPageUrl !== undefined) return cachedPageUrl;
    if (!isLinkableCommand(cmd) || !ctx.dbGroupId) {
      cachedPageUrl = null;
      return null;
    }
    const db = createAdminClient();
    const { data: trip } = await db
      .from("trips")
      .select("id")
      .eq("group_id", ctx.dbGroupId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    cachedPageUrl = trip?.id ? buildCommandPageUrl(cmd, trip.id) : null;
    return cachedPageUrl;
  };

  const withLink = async (message: ReplyPayload): Promise<ReplyPayload> => {
    const url = await resolvePageUrl();
    if (!url) return message;

    if (typeof message === "string") {
      return `${message}\n\n${BOT_COPY.viewLink(url)}`;
    }

    const container = message.contents;
    if (container.type !== "bubble" || container.body?.type !== "box") {
      return message;
    }
    return {
      ...message,
      contents: {
        ...container,
        body: {
          ...container.body,
          contents: [
            ...container.body.contents,
            { type: "separator", margin: "md" },
            {
              type: "text",
              text: BOT_COPY.viewLink(url),
              size: "xs",
              color: "#3B82F6",
              wrap: true,
              action: { type: "uri", label: BOT_COPY.viewLabel, uri: url },
            },
          ],
        },
      },
    };
  };

  // Helper that tries reply token first (single-use), then falls back to push.
  let replyToken = ctx.replyToken;
  const reply: Reply = async (message) => {
    const finalMessage = await withLink(message);

    if (replyToken) {
      const token = replyToken;
      replyToken = undefined;

      try {
        if (typeof finalMessage === "string") {
          await replyText(token, finalMessage);
        } else {
          await replyFlex(token, finalMessage.altText, finalMessage.contents);
        }
        return;
      } catch {
        // Token expired or LINE rejected it, so fall through to push.
      }
    }

    if (typeof finalMessage === "string") {
      await pushText(ctx.lineGroupId, finalMessage);
      return;
    }

    await pushFlex(
      ctx.lineGroupId,
      finalMessage.altText,
      finalMessage.contents,
      ctx.dbGroupId ?? undefined
    );
  };

  const route = COMMAND_ROUTE_MAP.get(cmd);

  if (!route) {
    await reply(BOT_COPY.unknownCommand);
    return;
  }

  if (!RATE_LIMIT_EXEMPT_COMMANDS.has(cmd)) {
    const groupLimit = await checkRateLimit("group", ctx.lineGroupId);
    if (!groupLimit.allowed) {
      await reply(BOT_COPY.groupRateLimited);
      return;
    }

    if (ctx.userId) {
      const userLimit = await checkRateLimit("user", ctx.userId);
      if (!userLimit.allowed) {
        await reply(BOT_COPY.userRateLimited);
        return;
      }
    }
  }

  await route.handler(args, ctx, reply);
}
