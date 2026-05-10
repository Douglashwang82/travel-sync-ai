import type { messagingApi } from "@line/bot-sdk";
type FlexComponent = messagingApi.FlexComponent;
type FlexBubble = messagingApi.FlexBubble;
import type { PlaceCandidate } from "./places";

export interface VoteOption {
  optionId: string;
  candidate: PlaceCandidate;
  voteCount: number;
}

/**
 * Build a Flex Message carousel for a vote.
 * Each card shows place info and a Vote button with postback data.
 *
 * Postback data format:  vote|{itemId}|{optionId}
 */
export function buildVoteCarousel(
  itemId: string,
  itemTitle: string,
  options: VoteOption[]
): messagingApi.FlexContainer {
  const bubbles: FlexBubble[] = options.map((opt) =>
    buildOptionBubble(itemId, itemTitle, opt)
  );

  return {
    type: "carousel",
    contents: bubbles,
  };
}

function buildOptionBubble(
  itemId: string,
  itemTitle: string,
  opt: VoteOption
): FlexBubble {
  const { candidate, voteCount, optionId } = opt;
  const postbackData = `vote|${itemId}|${optionId}`;

  const heroBlock: FlexComponent | undefined = candidate.photoUrl
    ? {
        type: "image",
        url: candidate.photoUrl,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      }
    : undefined;

  const ratingStr = candidate.rating ? `⭐ ${candidate.rating}` : null;
  const priceStr = candidate.priceLevel ?? null;
  const metaParts = [ratingStr, priceStr].filter(Boolean).join("  ·  ");

  const bodyContents: FlexComponent[] = [
    {
      type: "text",
      text: candidate.name,
      weight: "bold",
      size: "md",
      wrap: true,
    },
  ];

  if (metaParts) {
    bodyContents.push({
      type: "text",
      text: metaParts,
      size: "sm",
      color: "#888888",
      margin: "xs",
    });
  }

  if (candidate.address) {
    bodyContents.push({
      type: "text",
      text: candidate.address,
      size: "xs",
      color: "#aaaaaa",
      wrap: true,
      margin: "sm",
    });
  }

  if (voteCount > 0) {
    bodyContents.push({
      type: "text",
      text: `${voteCount} 票`,
      size: "xs",
      color: "#00b900",
      margin: "md",
    });
  }

  const footerContents: FlexComponent[] = [
    {
      type: "button",
      style: "primary",
      color: "#00b900",
      action: {
        type: "postback",
        label: voteCount > 0 ? `投票（${voteCount}）` : "投票",
        data: postbackData,
        displayText: `我投給 ${candidate.name}`,
      },
    },
  ];

  if (candidate.bookingUrl) {
    footerContents.push({
      type: "button",
      style: "link",
      action: {
        type: "uri",
        label: "查看詳情",
        uri: candidate.bookingUrl,
      },
    });
  }

  return {
    type: "bubble",
    ...(heroBlock ? { hero: heroBlock } : {}),
    body: {
      type: "box",
      layout: "vertical",
      contents: bodyContents,
      paddingAll: "md",
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: footerContents,
      spacing: "sm",
      paddingAll: "md",
    },
  };
}

/**
 * Build a simple announcement message when a vote closes.
 */
export function buildWinnerMessage(
  itemTitle: string,
  winnerName: string,
  voteCount: number,
  totalVotes: number
): string {
  return (
    `✅ 「${itemTitle}」的決定已完成！\n\n` +
    `🏆 ${winnerName}\n` +
    `${totalVotes} 票中的 ${voteCount} 票\n\n` +
    `可至控制台查看已確認的行程。`
  );
}
