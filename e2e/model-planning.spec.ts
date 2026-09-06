import { expect, test } from "@playwright/test";

/**
 * M7-5 / UF-004 & UF-007: Planning Journey
 * Flow:
 * 1. Unlock session & navigate to S-041 Model Grid
 * 2. Edit line item cell via formula bar
 * 3. Verify formula recalc / status / audit
 * 4. Navigate to S-051 Scenario Compare and compare scenarios
 */
test.describe("Model Planning Journey (UF-004 & UF-007)", () => {
  test("Open Model Grid -> Edit line item cell -> Verify formula recalc -> Compare scenarios", async ({
    page,
  }) => {
    // Step 1: Unlock session to open company
    await page.goto("/");
    const pinInput = page.getByRole("textbox", { name: "PIN" });
    await pinInput.fill("CorrectPin9!");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Navigate to S-041 Model Grid
    await page.goto("/app/model/grid");
    await expect(page.getByRole("heading", { name: "Model Grid" })).toBeVisible();

    // Verify grid region is loaded
    const grid = page.getByTestId("model-grid");
    await expect(grid).toBeVisible();

    // Step 2: Edit cell through the formula bar
    // Select a cell in the grid
    const firstCell = page.locator('[col-id^="p-"]').first();
    await expect(firstCell).toBeVisible();
    await firstCell.click();

    // Enter new value into formula bar
    const formulaBar = page.getByLabel("Formula bar");
    await expect(formulaBar).toBeVisible();
    await formulaBar.fill("250000.00");

    const applyBtn = page.getByRole("button", { name: "Apply" });
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();

    // Step 3: Verify recalc status or audit indicator
    await expect(
      page.locator("text=/recalculated/i").or(page.locator("text=/audit/i")),
    ).toBeVisible();

    // Step 4: Compare scenarios (S-051)
    await page.goto("/app/plan/compare");
    await expect(page.getByRole("heading", { name: "Scenario Compare" })).toBeVisible();

    // Check Scenario selectors
    const scenarioA = page.getByRole("combobox", { name: "Scenario A" });
    const scenarioB = page.getByRole("combobox", { name: "Scenario B" });
    await expect(scenarioA).toBeVisible();
    await expect(scenarioB).toBeVisible();

    // Select distinct scenarios if multiple available, or verify Compare interaction
    const optionsA = await scenarioA.locator("option").all();
    const optionsB = await scenarioB.locator("option").all();
    if (optionsA.length > 2 && optionsB.length > 2) {
      await scenarioA.selectOption({ index: 1 });
      await scenarioB.selectOption({ index: 2 });

      const compareBtn = page.getByRole("button", { name: "Compare" });
      await expect(compareBtn).toBeEnabled();
      await compareBtn.click();

      // Verify diff view or empty diff
      await expect(
        page.getByRole("button", { name: "Only changed" }).or(page.getByText("No differences")),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("Select two distinct Scenarios or Versions above to compare."),
      ).toBeVisible();
    }
  });
});
