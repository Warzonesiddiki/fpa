import { expect, test, type Page } from "@playwright/test";

/**
 * M7-5 / UF-002: GL Import Journey (E2E-TESTING §UF-002).
 * Parse → Mapping Wizard (canonical template) → Validation → Tie-Out → Commit.
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

/** The canonical balanced GL dump the mock core answers (dev-only preview fixture). */
const GL_CSV = [
  "period,account_code,debit,credit,posting_ref",
  "2026-08,4000,1000.00,0,REF-1",
  "2026-08,5000,0,1000.00,REF-2",
].join("\n");

test("Navigate to Import Hub -> Parse GL dump -> Map columns -> Validate -> Tie-Out -> Commit batch", async ({
  page,
}) => {
  await unlock(page);

  // Step 2: Data nav link → /app/import (S-030 Import Hub).
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Data" }).click();
  await expect(page).toHaveURL(/\/app\/import/);
  await expect(page.getByRole("heading", { name: "Import Hub" })).toBeVisible();

  // Step 3: GL Dump tab is the default source; pick a file via the dev-preview
  // browser input (aria-label "Choose an import file"), then parse locally.
  await expect(page.getByRole("tab", { name: "GL Dump" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "sample_gl_dump.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(GL_CSV),
  });
  await expect(page.getByText("Source selected")).toBeVisible();

  await page.getByRole("button", { name: "Parse locally" }).click();
  await expect(page.getByText("Source parsed")).toBeVisible();

  // Step 4: Continue to Mapping (S-031).
  await page.getByRole("button", { name: "Continue to Mapping" }).click();
  await expect(page).toHaveURL(/\/app\/import\/map/);
  await expect(page.getByRole("heading", { name: "Mapping Wizard" })).toBeVisible();

  // The canonical template is the zero-typing path (importHub.mappings.canonical).
  await page.getByRole("button", { name: "Use OneFP&A Canonical GL" }).click();
  await expect(page.getByText("OneFP&A Canonical GL selected")).toBeVisible();

  // Step 5: Validation runs from the mapping hand-off.
  const continueValidation = page.getByRole("button", { name: "Continue to Validation" });
  await expect(continueValidation).toBeEnabled();
  await continueValidation.click();

  // Step 6: Tie-Out (S-032) — validation must pass before the button enables.
  const continueTieOut = page.getByRole("button", { name: "Continue to Tie-Out" });
  await expect(continueTieOut).toBeEnabled();
  await continueTieOut.click();
  await expect(page).toHaveURL(/\/app\/import\/commit/);
  await expect(page.getByRole("heading", { name: "Tie-Out & Commit" })).toBeVisible();
  await expect(page.getByText("Balanced")).toBeVisible();

  // Step 7: Commit the audited batch (name is prefilled from the source file name).
  const commitBtn = page.getByRole("button", { name: "Commit Import Batch" });
  await expect(commitBtn).toBeEnabled();
  await commitBtn.click();

  await expect(page.getByText("Import Batch committed")).toBeVisible();
  await expect(page.getByText(/Batch ID: /)).toBeVisible();
  await expect(page.getByRole("link", { name: "View Import History" })).toBeVisible();
});
