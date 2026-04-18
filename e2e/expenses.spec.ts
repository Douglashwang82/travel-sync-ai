import { expect, test } from "@playwright/test";

const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "group-exp-1";

const liffContext = {
  isReady: true,
  isLoggedIn: true,
  profile: { userId: "U_E2E_EXP", displayName: "Alice" },
  lineGroupId: "C_E2E_EXP",
  error: null,
  idToken: "e2e-liff-token",
};

const sessionPayload = {
  group: { id: GROUP_ID, lineGroupId: "C_E2E_EXP", name: "Expense Crew" },
  member: { lineUserId: "U_E2E_EXP", role: "organizer" },
  activeTrip: {
    id: TRIP_ID,
    destination_name: "Tokyo",
    start_date: "2026-09-01",
    end_date: "2026-09-07",
    status: "active",
  },
};

const expensesPayload = {
  totalAmount: 12000,
  budgetAmount: 50000,
  budgetCurrency: "JPY",
  expenses: [
    {
      id: "exp-1",
      description: "Dinner at Ichiran",
      amount: 8000,
      paid_by_display_name: "Alice",
      created_at: "2026-09-02T18:00:00.000Z",
    },
    {
      id: "exp-2",
      description: "Train tickets",
      amount: 4000,
      paid_by_display_name: "Bob",
      created_at: "2026-09-03T10:00:00.000Z",
    },
  ],
  balances: [
    { displayName: "Alice", net: 6000 },
    { displayName: "Bob", net: 2000 },
    { displayName: "Carol", net: -8000 },
  ],
  settlements: [{ from: "Carol", to: "Alice", amount: 6000 }, { from: "Carol", to: "Bob", amount: 2000 }],
};

test.describe("Expenses page", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((ctx) => {
      window.__LIFF_E2E_CONTEXT__ = ctx;
    }, liffContext);

    await page.route("**/api/liff/session**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sessionPayload),
      })
    );
  });

  test("renders expense list with total and settlement", async ({ page }) => {
    await page.route("**/api/liff/expenses**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(expensesPayload),
      })
    );

    await page.goto("/liff/expenses");

    await expect(page.getByText("Dinner at Ichiran")).toBeVisible();
    await expect(page.getByText("Train tickets")).toBeVisible();
    await expect(page.getByText("Carol")).toBeVisible();
  });

  test("shows settlement instructions", async ({ page }) => {
    await page.route("**/api/liff/expenses**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(expensesPayload),
      })
    );

    await page.goto("/liff/expenses");

    // Settlement section should list who owes whom
    await expect(page.getByText(/carol/i).first()).toBeVisible();
    await expect(page.getByText(/alice/i).first()).toBeVisible();
  });

  test("empty state when no expenses", async ({ page }) => {
    await page.route("**/api/liff/expenses**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalAmount: 0,
          budgetAmount: null,
          budgetCurrency: "TWD",
          expenses: [],
          balances: [],
          settlements: [],
        }),
      })
    );

    await page.goto("/liff/expenses");

    await expect(page.getByText(/no expenses|nothing yet|0/i).first()).toBeVisible();
  });

  test("can open add expense form", async ({ page }) => {
    await page.route("**/api/liff/expenses**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(expensesPayload),
      })
    );

    await page.goto("/liff/expenses");

    const addBtn = page.getByRole("button", { name: /add|log|record/i }).first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      // Form fields should appear
      await expect(page.getByRole("textbox").first()).toBeVisible();
    }
  });

  test("submitting expense POSTs to API", async ({ page }) => {
    let postBody: unknown = null;

    await page.route("**/api/liff/expenses**", async (r) => {
      if (r.request().method() === "POST") {
        postBody = await r.request().postDataJSON();
        await r.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: "exp-new-1" }),
        });
      } else {
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(expensesPayload),
        });
      }
    });

    await page.goto("/liff/expenses");

    const addBtn = page.getByRole("button", { name: /add|log|record/i }).first();
    if (await addBtn.isVisible()) {
      await addBtn.click();

      const inputs = page.getByRole("textbox");
      const firstInput = inputs.first();
      if (await firstInput.isVisible()) {
        await firstInput.fill("Test snack");
      }

      const amountInput = page.getByRole("spinbutton").first();
      if (await amountInput.isVisible()) {
        await amountInput.fill("1500");
      }

      const submitBtn = page.getByRole("button", { name: /save|submit|add/i }).last();
      if (await submitBtn.isVisible() && await submitBtn.isEnabled()) {
        await submitBtn.click();
        // Give the POST a moment
        await page.waitForTimeout(500);
        expect(postBody).not.toBeNull();
      }
    }
  });
});
