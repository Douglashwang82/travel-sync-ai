import { replyText, pushText } from "@/lib/line";
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

export interface CommandContext {
  lineGroupId: string;
  dbGroupId: string | null;
  userId: string | undefined;
  replyToken: string | undefined;
}

type Reply = (text: string) => Promise<void>;

/**
 * Parse and route a slash command message to the appropriate handler.
 */
export async function routeCommand(
  text: string,
  ctx: CommandContext
): Promise<void> {
  const [rawCmd, ...args] = text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  // Helper that tries reply token first (single-use), falls back to push
  let replyToken = ctx.replyToken;
  const reply: Reply = async (message: string) => {
    if (replyToken) {
      const token = replyToken;
      replyToken = undefined; // consume — LINE reply tokens are one-shot
      try {
        await replyText(token, message);
        return;
      } catch {
        // token expired or LINE rejected it — fall through to push
      }
    }
    await pushText(ctx.lineGroupId, message);
  };

  // /help and /optout are always allowed — no rate limiting
  const unthrottledCmds = ["/help", "/optout", "/optin"];
  if (!unthrottledCmds.includes(cmd)) {
    // Group-level limit
    const groupLimit = checkRateLimit("group", ctx.lineGroupId);
    if (!groupLimit.allowed) {
      await reply(`Too many commands. Please wait a moment and try again.`);
      return;
    }
    // User-level limit
    if (ctx.userId) {
      const userLimit = checkRateLimit("user", ctx.userId);
      if (!userLimit.allowed) {
        await reply(`You're sending commands too quickly. Please slow down a little.`);
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

    case "/optout":
      await handleOptout(ctx, reply);
      break;

    case "/optin":
      await handleOptin(ctx, reply);
      break;

    default:
      await reply(
        `I didn't catch that! Type /help to see what I can do.`
      );
      break;
  }
}
