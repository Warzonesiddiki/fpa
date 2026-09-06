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

  // Error state: wrong PIN (must satisfy PIN policy length/classes to submit)
  const pinInput = page.getByRole("textbox", { name: "PIN" });
  await pinInput.fill("WrongPin9!");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Incorrect PIN.").first()).toBeVisible();

  // Success state: correct PIN
  await pinInput.fill("CorrectPin9!");
  await submit.click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
});
