import * as line from "@line/bot-sdk";
import { replyFlex, replyText, pushFlex, pushText } from "@/lib/line";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleStart } from "./commands/start";
import { handleHelp } from "./commands/help";
import { handleStatus } from "./commands/status";
import { handleAdd } from "./commands/add";
import { handleNudge } from "./commands/nudge";
import { handleVote } from "./commands/vote";
import { handleDecide } from "./commands/decide";
import { handleOptout, handleOptin } from "./commands/optout";
import { handleShare } from "./commands/share";
import { handleExp } from "./commands/exp";
import { handleExpSummary } from "./commands/exp-summary";
import { handleRecommend } from "./commands/recommend";
import { handleIncident } from "./commands/incident";
import { handleReady } from "./commands/ready";
import { handleOps } from "./commands/ops";
import { handleOption } from "./commands/option";
import { handleBooked } from "./commands/booked";
import { handleCancel } from "./commands/cancel";
import { handleComplete } from "./commands/complete";
import { handleAsk } from "./commands/ask";
import { handleTrack } from "./commands/track";
import { handleBudget } from "./commands/budget";
import { handleIdea, handleIdeas } from "./commands/idea";
import { handleDocs } from "./commands/docs";
import { handlePack } from "./commands/pack";
import { handleConfirm } from "./commands/confirm";
import { handleDeleteMyData } from "./commands/delete-data";

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

  // /help and /optout are always allowed without rate limiting.
  const unthrottledCmds = ["/help", "/optout", "/optin"];
  if (!unthrottledCmds.includes(cmd)) {
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

  switch (cmd) {
    case "/start":
      await handleStart(args, ctx, reply);
      break;

    case "/help":
      await handleHelp(reply);
      break;

    case "/status":
      await handleStatus(ctx, reply);
      break;

    case "/add":
      await handleAdd(args, ctx, reply);
      break;

    case "/nudge":
      await handleNudge(ctx, reply);
      break;

    case "/vote":
      await handleVote(args, ctx, reply);
      break;

    case "/decide":
      await handleDecide(args, ctx, reply);
      break;

    case "/option":
      await handleOption(args, ctx, reply);
      break;

    case "/share":
      await handleShare(args, ctx, reply);
      break;

    case "/recommend":
      await handleRecommend(args, ctx, reply);
      break;

    case "/ready":
      await handleReady(ctx, reply);
      break;

    case "/ops":
      await handleOps(ctx, reply);
      break;

    case "/incident":
      await handleIncident(args, ctx, reply);
      break;

    case "/booked":
      await handleBooked(args, ctx, reply);
      break;

    case "/exp":
      await handleExp(args, ctx, reply);
      break;

    case "/exp-summary":
      await handleExpSummary(ctx, reply);
      break;

    case "/cancel":
      await handleCancel(ctx, reply);
      break;

    case "/complete":
      await handleComplete(ctx, reply);
      break;

    case "/ask":
      await handleAsk(args, ctx, reply);
      break;

    case "/track":
      await handleTrack(args, ctx, reply);
      break;

    case "/budget":
      await handleBudget(args, ctx, reply);
      break;

    case "/idea":
      await handleIdea(args, ctx, reply);
      break;

    case "/ideas":
      await handleIdeas(ctx, reply);
      break;

    case "/docs":
      await handleDocs(args, ctx, reply);
      break;

    case "/pack":
      await handlePack(args, ctx, reply);
      break;

    case "/confirm":
      await handleConfirm(args, ctx, reply);
      break;

    case "/delete-my-data":
      await handleDeleteMyData(ctx, reply);
      break;

    case "/optout":
      await handleOptout(ctx, reply);
      break;

    case "/optin":
      await handleOptin(ctx, reply);
      break;

    default:
      await reply("I didn't catch that! Type /help to see what I can do.");
      break;
  }
}
