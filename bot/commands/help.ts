import { buildBotHelpText } from "@/lib/command-catalog";

const HELP_TEXT = buildBotHelpText();

export async function handleHelp(reply: (text: string) => Promise<void>): Promise<void> {
  await reply(HELP_TEXT);
}
