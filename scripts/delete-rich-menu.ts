/**
 * Delete a rich menu by ID (cleanup or re-run setup).
 *
 * Usage:
 *   npx tsx scripts/delete-rich-menu.ts <richMenuId>
 */

import * as line from "@line/bot-sdk";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const richMenuId = process.argv[2];

if (!channelAccessToken) {
  console.error("❌ LINE_CHANNEL_ACCESS_TOKEN is not set");
  process.exit(1);
}
if (!richMenuId) {
  console.error("❌ Usage: npx tsx scripts/delete-rich-menu.ts <richMenuId>");
  process.exit(1);
}

const client = new line.messagingApi.MessagingApiClient({ channelAccessToken });

async function main() {
  await client.deleteRichMenu(richMenuId);
  console.log(`✓ Deleted rich menu: ${richMenuId}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message ?? err);
  process.exit(1);
});
