import * as line from "@line/bot-sdk";
import { replyFlex, replyText, pushFlex, pushText } from "@/lib/line";
import { checkRateLimit } from "@/lib/rate-limit";
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

  // Helper that tries reply token first (single-use), then falls back to push.
  let replyToken = ctx.replyToken;
  const reply: Reply = async (message) => {
    if (replyToken) {
      const token = replyToken;
      replyToken = undefined;

      try {
        if (typeof message === "string") {
          await replyText(token, message);
        } else {
          await replyFlex(token, message.altText, message.contents);
        }
        return;
      } catch {
        // Token expired or LINE rejected it, so fall through to push.
      }
    }

    if (typeof message === "string") {
      await pushText(ctx.lineGroupId, message);
      return;
    }

    await pushFlex(
      ctx.lineGroupId,
      message.altText,
      message.contents,
      ctx.dbGroupId ?? undefined
    );
  };

  const route = COMMAND_ROUTE_MAP.get(cmd);

  if (!route) {
    await reply("I didn't catch that! Type /help to see what I can do.");
    return;
  }

  if (!RATE_LIMIT_EXEMPT_COMMANDS.has(cmd)) {
    const groupLimit = await checkRateLimit("group", ctx.lineGroupId);
    if (!groupLimit.allowed) {
      await reply("Too many commands. Please wait a moment and try again.");
      return;
    }

    if (ctx.userId) {
      const userLimit = await checkRateLimit("user", ctx.userId);
      if (!userLimit.allowed) {
        await reply("You're sending commands too quickly. Please slow down a little.");
        return;
      }
    }
  }

  await route.handler(args, ctx, reply);
}
