import { expect, test, type Page } from "@playwright/test";

/**
 * M7-5 / UF-001: Company Lifecycle Journey (E2E-TESTING §UF-001).
 * Unlock → Companies → First-Run Wizard (5 steps) → Dashboard.
 * The dev-preview core keeps the session in memory: full page loads reset it to
 * locked, so every in-app step navigates SPA-style (buttons/links, no page.goto).
 */

/** Unlock S-001 once; every later step must navigate SPA-style. */
async function unlock(page: Page): Promise<void> {
  await page.goto("/");
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("CorrectPin9!");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
}

test("Unlock -> Companies -> First-Run Wizard creates a Company -> Dashboard", async ({ page }) => {
  await unlock(page);

  // Step 2: Companies page → New Company opens the wizard route (/wizard).
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Companies" })
    .click();
  await expect(page).toHaveURL(/\/app\/companies/);
  await page.getByRole("button", { name: "New Company" }).click();
  await expect(page).toHaveURL(/\/wizard/);
  // The wizard header is a step list + per-step card heading (no <h1> page title).
  await expect(page.getByRole("list")).toContainText("1. Company");
  await expect(page.getByRole("heading", { name: "Company", level: 2 })).toBeVisible();

  // Step 3.1: Company name gates the Next button (S-002 step "Company").
  const uniqueName = `Solaris Dynamics ${Date.now()}`;
  await page.getByLabel("Company name").fill(uniqueName);
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3.2: Industry Pack — radio cards whose accessible name is
  // "<name> <version> <description>"; anchor on the exact unique name.
  await expect(page.getByText("Manufacturing")).toBeVisible();
  await page.getByRole("radio", { name: /^Manufacturing v/ }).check();

  await page.getByRole("button", { name: "Next" }).click();

  // Step 3.3: Fiscal Calendar (12-month default; preview renders once loaded).
  await expect(page.getByRole("heading", { name: "Fiscal Calendar" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3.4: Chart of Accounts review.
  await expect(page.getByRole("heading", { name: "Chart of Accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3.5: Model step — Create Company.
  await expect(page.getByRole("heading", { name: "Model" })).toBeVisible();
  const createBtn = page.getByRole("button", { name: "Create Company" });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // Steps 4 & 5: S-002 success opens the Company and lands on the S-010 Dashboard.
  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/Plan-Only/)).toBeVisible();
});
