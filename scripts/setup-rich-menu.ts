/**
 * One-time script to create the LINE persistent rich menu and link it
 * as the default for all users.
 *
 * Usage:
 *   npx tsx scripts/setup-rich-menu.ts
 *
 * Requires these env vars to be set (copy from .env.local or export them):
 *   LINE_CHANNEL_ACCESS_TOKEN
 *   NEXT_PUBLIC_LIFF_ID
 */

import * as line from "@line/bot-sdk";

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

if (!channelAccessToken) {
  console.error("❌ LINE_CHANNEL_ACCESS_TOKEN is not set");
  process.exit(1);
}
if (!liffId) {
  console.warn("⚠️  NEXT_PUBLIC_LIFF_ID is not set — LIFF URLs will be placeholders");
}

const client = new line.messagingApi.MessagingApiClient({ channelAccessToken });

// LIFF URLs for each tab
const dashboardUrl = liffId ? `https://liff.line.me/${liffId}/liff/dashboard` : "https://example.com/liff/dashboard";
const itineraryUrl = liffId ? `https://liff.line.me/${liffId}/liff/itinerary` : "https://example.com/liff/itinerary";
const helpUrl     = liffId ? `https://liff.line.me/${liffId}/liff/help`      : "https://example.com/liff/help";

const richMenuBody: line.messagingApi.RichMenuRequest = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: "TravelSync AI Menu",
  chatBarText: "Trip Menu",
  areas: [
    // Dashboard — left third
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: {
        type: "uri",
        label: "Dashboard",
        uri: dashboardUrl,
      },
    },
    // Itinerary — middle third
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: {
        type: "uri",
        label: "Itinerary",
        uri: itineraryUrl,
      },
    },
    // Help — right third
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: {
        type: "message",
        label: "Help",
        text: "/help",
      },
    },
  ],
};

async function main() {
  console.log("Creating rich menu...");
  const { richMenuId } = await client.createRichMenu(richMenuBody);
  console.log(`✓ Rich menu created: ${richMenuId}`);

  // Note: You must upload an image separately using the LINE console or
  // the Rich Menu Image API before the menu renders visually.
  // Endpoint: POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content
  console.log(`\n⚠️  Upload a rich menu image (2500×843px) via LINE console or:`);
  console.log(`   curl -X POST https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content \\`);
  console.log(`     -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \\`);
  console.log(`     -H "Content-Type: image/png" \\`);
  console.log(`     --data-binary @rich-menu.png`);

  console.log("\nSetting as default rich menu for all users...");
  await client.setDefaultRichMenu(richMenuId);
  console.log(`✓ Default rich menu set to ${richMenuId}`);

  console.log("\nDone! Rich menu is active for all new conversations.");
  console.log(`\nRich menu ID: ${richMenuId}`);
  console.log("Save this ID if you need to delete or update the menu later:");
  console.log(`  npx tsx scripts/delete-rich-menu.ts ${richMenuId}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message ?? err);
  process.exit(1);
});
