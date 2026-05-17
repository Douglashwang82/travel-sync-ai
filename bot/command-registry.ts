import type { CommandCatalogEntry, CommandName } from "@/lib/command-catalog";
import { COMMAND_CATALOG } from "@/lib/command-catalog";
import { handleAdd } from "./commands/add";
import { handleAsk } from "./commands/ask";
import { handleBooked } from "./commands/booked";
import { handleBudget } from "./commands/budget";
import { handleCancel } from "./commands/cancel";
import { handleComplete } from "./commands/complete";
import { handleConfirm } from "./commands/confirm";
import { handleDecide } from "./commands/decide";
import { handleDeleteMyData } from "./commands/delete-data";
import { handleDocs } from "./commands/docs";
import { handleExp } from "./commands/exp";
import { handleExpSummary } from "./commands/exp-summary";
import { handleHelp } from "./commands/help";
import { handleIdea, handleIdeas } from "./commands/idea";
import { handleIncident } from "./commands/incident";
import { handleItinerary } from "./commands/itinerary";
import { handleNudge } from "./commands/nudge";
import { handleOps } from "./commands/ops";
import { handleOption } from "./commands/option";
import { handleOptin, handleOptout } from "./commands/optout";
import { handlePack } from "./commands/pack";
import { handlePlan } from "./commands/plan";
import { handleReady } from "./commands/ready";
import { handleRecommend } from "./commands/recommend";
import { handleShare } from "./commands/share";
import { handleStart } from "./commands/start";
import { handleStatus } from "./commands/status";
import { handleTrack } from "./commands/track";
import { handleVote } from "./commands/vote";
import type { CommandContext, Reply } from "./router";

export type CommandHandler = (
  args: string[],
  ctx: CommandContext,
  reply: Reply
) => Promise<void>;

function noArgs(handler: (ctx: CommandContext, reply: Reply) => Promise<void>): CommandHandler {
  return (_args, ctx, reply) => handler(ctx, reply);
}

function replyOnly(handler: (reply: Reply) => Promise<void>): CommandHandler {
  return (_args, _ctx, reply) => handler(reply);
}

export type CommandRoute = CommandCatalogEntry & {
  handler: CommandHandler;
};

const COMMAND_HANDLERS = {
  "/start": handleStart,
  "/status": noArgs(handleStatus),
  "/plan": handlePlan,
  "/itinerary": handleItinerary,
  "/add": handleAdd,
  "/idea": handleIdea,
  "/ideas": noArgs(handleIdeas),
  "/decide": handleDecide,
  "/option": handleOption,
  "/vote": handleVote,
  "/nudge": noArgs(handleNudge),
  "/ready": noArgs(handleReady),
  "/ops": noArgs(handleOps),
  "/incident": handleIncident,
  "/booked": handleBooked,
  "/confirm": handleConfirm,
  "/docs": handleDocs,
  "/pack": handlePack,
  "/budget": handleBudget,
  "/exp": handleExp,
  "/exp-summary": noArgs(handleExpSummary),
  "/ask": handleAsk,
  "/share": handleShare,
  "/recommend": handleRecommend,
  "/track": handleTrack,
  "/cancel": noArgs(handleCancel),
  "/complete": noArgs(handleComplete),
  "/delete-my-data": noArgs(handleDeleteMyData),
  "/optout": noArgs(handleOptout),
  "/optin": noArgs(handleOptin),
  "/help": replyOnly(handleHelp),
} satisfies Record<CommandName, CommandHandler>;

export const COMMAND_ROUTES: CommandRoute[] = COMMAND_CATALOG.map((entry) => ({
  ...entry,
  handler: COMMAND_HANDLERS[entry.command],
}));

export const COMMAND_ROUTE_MAP = new Map(
  COMMAND_ROUTES.map((route) => [route.command, route])
);

export const RATE_LIMIT_EXEMPT_COMMANDS = new Set(
  COMMAND_ROUTES.filter((route) => route.rateLimitExempt).map((route) => route.command)
);
