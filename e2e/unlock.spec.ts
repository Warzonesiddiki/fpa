import { expect, test } from "@playwright/test";

/** P0 screen states, keyboard-operable (SCREENS-SPEC S-001; Q1/Q4). */
test("S-001 unlock: shows recent company, wrong PIN errors, correct PIN unlocks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Enter your PIN to open your Company")).toBeVisible();

  // Populated: 5-state list with recent Company
  await expect(page.getByText("Meridian Holdings (Demo)")).toBeVisible();

  // Empty PIN cannot submit
  const submit = page.getByRole("button", { name: "Unlock" });
  await expect(submit).toBeDisabled();

  // Error state: wrong PIN
  await page.getByLabel("PIN").fill("wrong");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Incorrect PIN.")).toBeVisible();

  // Success state: correct PIN
  await page.getByLabel("PIN").fill("1234");
  await submit.click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
});
