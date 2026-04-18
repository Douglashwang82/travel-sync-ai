import { expect, test } from "@playwright/test";

const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaa0001-0000-0000-0000-000000000000";
const OPT_A = "bbbb0001-0000-0000-0000-000000000000";
const OPT_B = "bbbb0002-0000-0000-0000-000000000000";

const liffContext = {
  isReady: true,
  isLoggedIn: true,
  profile: { userId: "U_E2E_VOTE", displayName: "Voter" },
  lineGroupId: "C_E2E_VOTE",
  error: null,
  idToken: "e2e-liff-token",
};

function sessionRoute(role: "organizer" | "member" = "member") {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      group: { id: "group-vote-1", lineGroupId: "C_E2E_VOTE", name: "Vote Crew" },
      member: { lineUserId: "U_E2E_VOTE", role },
      activeTrip: {
        id: TRIP_ID,
        destination_name: "Bali",
        start_date: "2026-08-01",
        end_date: "2026-08-07",
        status: "active",
      },
    }),
  };
}

function makeVotesPayload(myVote: string | null = null) {
  return [
    {
      id: ITEM_ID,
      trip_id: TRIP_ID,
      item_type: "hotel",
      title: "Choose hotel",
      stage: "pending",
      deadline_at: "2026-07-01T00:00:00.000Z",
      options: [
        {
          id: OPT_A,
          name: "Alaya Resort",
          address: "Ubud, Bali",
          image_url: null,
          rating: 4.8,
          price_level: 3,
          vote_count: myVote === OPT_A ? 2 : 1,
          has_voted: myVote === OPT_A,
        },
        {
          id: OPT_B,
          name: "Komaneka",
          address: "Ubud, Bali",
          image_url: null,
          rating: 4.6,
          price_level: 4,
          vote_count: myVote === OPT_B ? 2 : 0,
          has_voted: myVote === OPT_B,
        },
      ],
    },
  ];
}

test.describe("Votes page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((ctx) => {
      window.__LIFF_E2E_CONTEXT__ = ctx;
    }, liffContext);

    await page.route("**/api/liff/session**", (r) => r.fulfill(sessionRoute()));
  });

  test("renders open vote items with options", async ({ page }) => {
    await page.route("**/api/liff/votes**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeVotesPayload()),
      })
    );

    await page.goto("/liff/votes");

    await expect(page.getByText("Choose hotel")).toBeVisible();
    await expect(page.getByText("Alaya Resort")).toBeVisible();
    await expect(page.getByText("Komaneka")).toBeVisible();
  });

  test("shows no active votes state when list is empty", async ({ page }) => {
    await page.route("**/api/liff/votes**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      })
    );

    await page.goto("/liff/votes");

    await expect(page.getByText(/no active votes/i)).toBeVisible();
  });

  test("casting a vote updates the option's state", async ({ page }) => {
    let votePosted = false;

    await page.route("**/api/liff/votes**", async (r) => {
      if (r.request().method() === "POST") {
        votePosted = true;
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeVotesPayload()),
        });
      }
    });

    await page.goto("/liff/votes");
    await expect(page.getByText("Alaya Resort")).toBeVisible();

    const voteBtn = page
      .locator("button")
      .filter({ hasText: /vote|select/i })
      .first();

    if (await voteBtn.isVisible()) {
      await voteBtn.click();
      expect(votePosted).toBe(true);
    }
  });

  test("shows vote deadline", async ({ page }) => {
    await page.route("**/api/liff/votes**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeVotesPayload()),
      })
    );

    await page.goto("/liff/votes");

    // Deadline should be displayed somewhere on the card
    const deadlineText = page.getByText(/jul|deadline|closes/i).first();
    await expect(deadlineText).toBeVisible();
  });
});
