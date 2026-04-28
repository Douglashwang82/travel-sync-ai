import { expect, test } from "@playwright/test";

const liffContext = {
  isReady: true,
  isLoggedIn: true,
  profile: {
    userId: "U_E2E_001",
    displayName: "Avery",
  },
  lineGroupId: "C_E2E_001",
  error: null,
  idToken: "e2e-liff-token",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((context) => {
    window.__LIFF_E2E_CONTEXT__ = context;
  }, liffContext);
});

test("redirects /liff to the trip list, then opens a trip's board", async ({ page }) => {
  const TRIP_ID = "11111111-1111-4111-8111-111111111111";

  await page.route("**/api/liff/trips**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trips: [
          {
            id: TRIP_ID,
            groupId: "group-e2e-1",
            groupName: "Trip Crew",
            destinationName: "Kyoto",
            startDate: "2026-06-01",
            endDate: "2026-06-07",
            status: "active",
            itemCount: 3,
            createdAt: "2026-04-01T10:00:00.000Z",
          },
          {
            id: "22222222-2222-4222-8222-222222222222",
            groupId: "group-e2e-1",
            groupName: "Trip Crew",
            destinationName: "Sapporo",
            startDate: "2026-01-01",
            endDate: "2026-01-05",
            status: "completed",
            itemCount: 5,
            createdAt: "2026-01-10T10:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/liff/board**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        trip: {
          id: TRIP_ID,
          group_id: "group-e2e-1",
          title: null,
          destination_name: "Kyoto",
          destination_place_id: null,
          start_date: "2026-06-01",
          end_date: "2026-06-07",
          status: "active",
          created_by_user_id: "U_E2E_001",
          created_at: "2026-04-01T10:00:00.000Z",
          ended_at: null,
        },
        todo: [
          {
            id: "item-1",
            trip_id: TRIP_ID,
            item_type: "hotel",
            item_kind: "task",
            title: "Book hotel",
            description: null,
            stage: "todo",
            source: "manual",
            status_reason: null,
            confirmed_option_id: null,
            deadline_at: null,
            tie_extension_count: 0,
            created_at: "2026-04-01T10:00:00.000Z",
            updated_at: "2026-04-01T10:00:00.000Z",
          },
        ],
        pending: [
          {
            id: "item-2",
            trip_id: TRIP_ID,
            item_type: "flight",
            item_kind: "decision",
            title: "Vote on flight",
            description: null,
            stage: "pending",
            source: "manual",
            status_reason: null,
            confirmed_option_id: null,
            deadline_at: null,
            tie_extension_count: 0,
            created_at: "2026-04-01T10:00:00.000Z",
            updated_at: "2026-04-01T10:00:00.000Z",
          },
        ],
        confirmed: [
          {
            id: "item-3",
            trip_id: TRIP_ID,
            item_type: "transport",
            item_kind: "task",
            title: "Meet at station",
            description: "Tokyo Station",
            stage: "confirmed",
            source: "manual",
            status_reason: null,
            confirmed_option_id: null,
            deadline_at: null,
            tie_extension_count: 0,
            created_at: "2026-04-01T10:00:00.000Z",
            updated_at: "2026-04-01T10:00:00.000Z",
          },
        ],
        currentUser: { lineUserId: "U_E2E_001", role: "organizer" },
      }),
    });
  });

  await page.goto("/liff");

  // Trip list at /liff/dashboard
  await expect(page).toHaveURL(/\/liff\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await expect(page.getByText("Active & drafts")).toBeVisible();
  await expect(page.getByText("Past trips")).toBeVisible();
  await expect(page.getByText("Kyoto")).toBeVisible();
  await expect(page.getByText("Sapporo")).toBeVisible();

  // Tap into the active trip → board view
  await page.getByRole("link", { name: /Kyoto/ }).click();
  await expect(page).toHaveURL(new RegExp(`/liff/trips/${TRIP_ID}$`));
  await expect(page.getByRole("heading", { name: "Kyoto" })).toBeVisible();
  await expect(page.getByText("Book hotel")).toBeVisible();
  await expect(page.getByText("Vote on flight")).toBeVisible();
});

test("renders the readiness page with mocked LIFF and API data", async ({ page }) => {
  await page.route("**/api/liff/session**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        group: {
          id: "group-e2e-1",
          lineGroupId: "C_E2E_001",
          name: "Trip Crew",
        },
        member: {
          lineUserId: "U_E2E_001",
          role: "organizer",
        },
        activeTrip: {
          id: "11111111-1111-4111-8111-111111111111",
          destination_name: "Kyoto",
          start_date: "2026-06-01",
          end_date: "2026-06-07",
          status: "active",
        },
      }),
    });
  });

  await page.route("**/api/liff/readiness**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tripId: "11111111-1111-4111-8111-111111111111",
        trip: {
          destinationName: "Kyoto",
          startDate: "2026-06-01",
          endDate: "2026-06-07",
        },
        confidenceScore: 82,
        completionPercent: 68,
        blockers: [
          {
            id: "blocker-1",
            tripId: "11111111-1111-4111-8111-111111111111",
            category: "documents",
            title: "Passport renewal pending",
            description: "One traveler still needs a valid passport.",
            severity: "critical",
            status: "open",
            dueAt: "2026-05-20T00:00:00.000Z",
            sourceKind: "system",
            evidence: ["Passport expires in 3 months"],
          },
        ],
        items: [
          {
            id: "blocker-1",
            tripId: "11111111-1111-4111-8111-111111111111",
            category: "documents",
            title: "Passport renewal pending",
            description: "One traveler still needs a valid passport.",
            severity: "critical",
            status: "open",
            dueAt: "2026-05-20T00:00:00.000Z",
            sourceKind: "system",
            evidence: ["Passport expires in 3 months"],
          },
          {
            id: "item-2",
            tripId: "11111111-1111-4111-8111-111111111111",
            category: "transport",
            title: "Airport transfer confirmed",
            description: "Van reservation is locked in.",
            severity: "low",
            status: "completed",
            dueAt: null,
            sourceKind: "manual",
            evidence: ["Confirmation number ABC123"],
          },
        ],
        missingInputs: ["Return train time is still missing."],
        committedSourceSummary: [
          "Flights are confirmed for all travelers.",
          "Hotel booking is committed in the board.",
        ],
      }),
    });
  });

  await page.goto("/liff/readiness");

  await expect(page.getByRole("heading", { name: "Kyoto" })).toBeVisible();
  await expect(page.getByText("Trip readiness")).toBeVisible();
  await expect(
    page.locator("section").filter({ hasText: "Priority Blockers" }).getByText("Passport renewal pending")
  ).toBeVisible();
  await expect(page.getByText("Return train time is still missing.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open ops" })).toBeVisible();
});

test("renders the help page command and LIFF navigation guidance", async ({ page }) => {
  await page.goto("/liff/help");

  await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LIFF Views" })).toBeVisible();
  const liffViewsSection = page.locator("section").filter({ hasText: "LIFF Views" });
  const commandsSection = page.locator("section").filter({ hasText: "Commands" });
  await expect(liffViewsSection.getByRole("link", { name: "Trips" })).toBeVisible();
  await expect(liffViewsSection.getByRole("link", { name: "Readiness" })).toBeVisible();
  await expect(liffViewsSection.getByRole("link", { name: "Operations" })).toBeVisible();
  await expect(commandsSection.getByText("/help").first()).toBeVisible();
});
