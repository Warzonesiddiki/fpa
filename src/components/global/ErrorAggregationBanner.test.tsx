import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { axe } from "vitest-axe";
import { ErrorAggregationBanner } from "./ErrorAggregationBanner";
import { useErrorLogStore } from "@/stores/errorLog";
import { call } from "@/api/bridge";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

import "@testing-library/jest-dom/vitest";

function renderBanner() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ErrorAggregationBanner />
    </I18nextProvider>,
  );
}

const record = (code: string, userMessage: string, times: number) => {
  for (let i = 0; i < times; i++) useErrorLogStore.getState().record({ code, userMessage }, i);
};

describe("ErrorAggregationBanner — ERROR-HANDLING §3 rule 7", () => {
  beforeEach(() => useErrorLogStore.getState().clear());

  it("stays hidden below the threshold (4 identical errors)", () => {
    record("VALUE_INVALID", "Value is not valid for this cell ({type}).", 4);
    renderBanner();
    expect(screen.queryByTestId("error-aggregation-banner")).not.toBeInTheDocument();
  });

  it("appears collapsed at 5 identical errors, showing code and count", () => {
    record("VALUE_INVALID", "Value is not valid for this cell ({type}).", 7);
    renderBanner();
    expect(screen.getByTestId("error-aggregation-banner")).toBeInTheDocument();
    expect(screen.getByText(/VALUE_INVALID ×7/)).toBeInTheDocument();
    // collapsed: the log table is not rendered yet
    expect(screen.queryByTestId("error-log")).not.toBeInTheDocument();
  });

  it("View error log expands the log and dismiss removes the group", async () => {
    const user = userEvent.setup();
    record("VALUE_INVALID", "Value is not valid for this cell ({type}).", 5);
    renderBanner();
    await user.click(screen.getByRole("button", { name: /view error log/i }));
    expect(screen.getByTestId("error-log")).toBeInTheDocument();
    expect(screen.getByText("Value is not valid for this cell ({type}).")).toBeInTheDocument();
    expect(screen.getByText(/5× in the last minute/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss VALUE_INVALID/i }));
    expect(screen.queryByTestId("error-aggregation-banner")).not.toBeInTheDocument();
  });

  it("summarises extra groups beyond three chips", () => {
    const msg = (n: number) => `Copy ${n}.`;
    for (let n = 0; n < 4; n++) record(`CODE_${n}`, msg(n), 5);
    renderBanner();
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("END-TO-END: 5 bridge failures raise the banner without any screen logging code", async () => {
    // Invalid args take the zod path of call() — no mock core, no Tauri, no screen
    // involvement: the bridge tap alone must feed the log (§3 rule 7's "identical
    // errors" = same code + same userMessage).
    for (let i = 0; i < 5; i++) {
      await expect(
        // model.cell.set.v1 expects typed args; a string where an object is required fails zod.
        call("model.cell.set.v1", "not-an-object" as never),
      ).rejects.toMatchObject({ code: "VALUE_INVALID" });
    }
    renderBanner();
    expect(screen.getByTestId("error-aggregation-banner")).toBeInTheDocument();
    expect(screen.getByText(/VALUE_INVALID ×5/)).toBeInTheDocument();
  });

  it("has 0 axe accessibility violations (collapsed and expanded)", async () => {
    record("VALUE_INVALID", "Value is not valid for this cell ({type}).", 5);
    const { container } = renderBanner();
    expect((await axe(container)).violations).toEqual([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /view error log/i }));
    expect((await axe(container)).violations).toEqual([]);
  });
});
