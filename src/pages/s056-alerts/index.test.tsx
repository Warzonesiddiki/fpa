/**
 * S-056 Alerts Center page tests (F-026 · M5-4 · SCREENS-SPEC S-056).
 *
 * The store is real but pre-seeded per test (load/create actions stubbed), mirroring the
 * S-060 harness idiom. Covers: header/filters chrome, severity grouping with h2 sections,
 * trigger-chain disclosure (first-class row per WIREFRAMES), the disabled pending
 * dismiss/mute buttons, all five states including the "All clear" empty copy, the
 * inline (non-blanking) create error, and axe on the substantive states.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { axe } from "vitest-axe";
import { AlertsPage } from "./index";
import { useAlertsStore } from "@/stores/alerts";
import type { AlertRecord } from "@/api/schema";

function alertRecord(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: "b0b00000-0000-4000-8000-000000000001",
    rule_id: "a1e00000-0000-4000-8000-000000000001",
    rule_name: "Cash floor (13-week)",
    severity: "warning",
    fired_at: "2026-09-05T06:30:00Z",
    trigger_chain: {
      rule: "Cash floor (13-week)",
      line: "line-cash",
      period_id: "fp-2026-p06",
      value: "2400000000",
      threshold: "2500000000",
    },
    dismissed_at: null,
    ...overrides,
  };
}

const POPULATED: AlertRecord[] = [
  alertRecord(),
  alertRecord({
    id: "b0b00000-0000-4000-8000-000000000010",
    rule_id: "a1e00000-0000-4000-8000-000000000002",
    rule_name: "Leverage covenant",
    severity: "critical",
  }),
];

function seed(partial: Record<string, unknown> = {}) {
  useAlertsStore.setState({
    status: "populated",
    error: null,
    createError: null,
    alerts: POPULATED,
    filter: { severity: null, includeDismissed: false },
    creating: false,
    lastCreatedRuleId: null,
    loadAlerts: vi.fn().mockResolvedValue(true),
    setSeverityFilter: vi.fn().mockResolvedValue(undefined),
    setIncludeDismissed: vi.fn().mockResolvedValue(undefined),
    createRule: vi.fn().mockResolvedValue(true),
    retry: vi.fn().mockResolvedValue(true),
    ...partial,
  });
}

describe("S-056 Alerts page", () => {
  beforeEach(() => {
    seed();
  });

  it("renders header, subtitle and the filter group", () => {
    render(<AlertsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Alerts" })).toBeInTheDocument();
    expect(screen.getByText(/list is the record/i)).toBeInTheDocument();
    const filters = screen.getByRole("group", { name: "Alert filters" });
    expect(within(filters).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(filters).getByRole("button", { name: "Critical" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("groups alerts by severity with h2 section headings and counts", () => {
    render(<AlertsPage />);
    const criticalHeading = screen.getByRole("heading", { level: 2, name: /Critical/ });
    const warningHeading = screen.getByRole("heading", { level: 2, name: /Warning/ });
    expect(
      within(criticalHeading.parentElement as HTMLElement).getByText("Leverage covenant"),
    ).toBeInTheDocument();
    expect(warningHeading).toHaveTextContent("(1)");
    expect(screen.getByText("Cash floor (13-week)")).toBeInTheDocument();
  });

  it("expands the trigger chain disclosure with exact decimal strings", async () => {
    render(<AlertsPage />);
    const item = screen.getByText("Cash floor (13-week)").closest("li") as HTMLElement;
    const toggle = within(item).getByRole("button", { name: /Trigger chain/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(item).getByText("2400000000")).toBeInTheDocument();
    expect(within(item).getByText("2500000000")).toBeInTheDocument();
    expect(within(item).getByText("fp-2026-p06")).toBeInTheDocument();
  });

  it("renders fired_at as a <time> element with the machine-readable instant", () => {
    render(<AlertsPage />);
    const el = document.querySelector("time[datetime='2026-09-05T06:30:00Z']");
    expect(el).not.toBeNull();
  });

  it("dismiss and mute are present but honestly disabled with explanation", () => {
    render(<AlertsPage />);
    const item = screen.getByText("Cash floor (13-week)").closest("li") as HTMLElement;
    const dismiss = within(item).getByRole("button", { name: "Dismiss" });
    const mute = within(item).getByRole("button", { name: "Mute rule" });
    expect(dismiss).toBeDisabled();
    expect(mute).toBeDisabled();
    expect(dismiss.getAttribute("title")).toMatch(/not in the locked API catalog/i);
    expect(mute.getAttribute("title")).toMatch(/alerts\.mute_rule/);
  });

  it("filter buttons call the store setters", async () => {
    const setSeverityFilter = vi.fn().mockResolvedValue(undefined);
    seed({ setSeverityFilter });
    render(<AlertsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Critical" }));
    expect(setSeverityFilter).toHaveBeenCalledWith("critical");
  });

  it("shows the 'All clear' empty state", () => {
    seed({ status: "empty", alerts: [] });
    render(<AlertsPage />);
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });

  it("shows the loading state", () => {
    seed({ status: "loading", alerts: [] });
    render(<AlertsPage />);
    expect(screen.getByRole("status", { name: /Loading/ })).toBeInTheDocument();
  });

  it("shows the error state with the typed code and no retry for non-retryable", () => {
    seed({
      status: "error",
      alerts: [],
      error: {
        code: "SESSION_LOCKED",
        userMessage: "Session locked. Unlock to continue.",
        httpStatus: 401,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    render(<AlertsPage />);
    expect(screen.getByText("Session locked. Unlock to continue.")).toBeInTheDocument();
    expect(screen.getByText("SESSION_LOCKED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers retry for retryable list errors", async () => {
    const retry = vi.fn().mockResolvedValue(true);
    seed({
      status: "error",
      alerts: [],
      retry,
      error: {
        code: "INTERNAL",
        userMessage: "An unexpected error occurred.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      },
    });
    render(<AlertsPage />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("submits the rule form through createRule with the exact payload", async () => {
    const createRule = vi.fn().mockResolvedValue(true);
    seed({ createRule });
    render(<AlertsPage />);
    await userEvent.type(screen.getByLabelText("Rule name"), "Cash floor (13-week)");
    await userEvent.type(screen.getByLabelText("Model line id"), "line-cash");
    await userEvent.type(screen.getByLabelText(/Threshold/), "2500000000");
    await userEvent.click(screen.getByRole("button", { name: "+ Rule" }));
    expect(createRule).toHaveBeenCalledWith({
      name: "Cash floor (13-week)",
      kpi_id: null,
      line_ref: "line-cash",
      threshold_operator: "lt",
      threshold_value: "2500000000",
      severity: "warning",
      active: true,
    });
  });

  it("switching the target to KPI swaps the input and the payload", async () => {
    const createRule = vi.fn().mockResolvedValue(true);
    seed({ createRule });
    render(<AlertsPage />);
    await userEvent.type(screen.getByLabelText("Rule name"), "Covenant leverage");
    await userEvent.click(screen.getByRole("radio", { name: "KPI" }));
    await userEvent.type(screen.getByLabelText("KPI id"), "kpi-leverage");
    await userEvent.type(screen.getByLabelText(/Threshold/), "3.5");
    await userEvent.click(screen.getByRole("button", { name: "+ Rule" }));
    expect(createRule).toHaveBeenCalledWith(
      expect.objectContaining({ kpi_id: "kpi-leverage", line_ref: null }),
    );
  });

  it("renders the create error inline without touching the list", () => {
    seed({
      createError: {
        code: "ALERT_RULE_INVALID",
        userMessage: "Alert rule invalid: threshold_value must be an exact decimal string",
        httpStatus: 422,
        retryable: false,
        retryAfterMs: null,
        details: {},
      },
    });
    render(<AlertsPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Alert rule invalid: threshold_value must be an exact decimal string",
    );
    expect(alert).toHaveTextContent("ALERT_RULE_INVALID");
    // list still populated behind the inline error
    expect(screen.getByText("Cash floor (13-week)")).toBeInTheDocument();
  });

  it("shows the created-rule confirmation chip when the store records one", () => {
    seed({ lastCreatedRuleId: "c1c1c1c1-1111-4111-8111-111111111111" });
    render(<AlertsPage />);
    const chip = screen.getByText(/Rule created/i);
    expect(chip.parentElement?.textContent).toContain("c1c1c1c1");
  });

  it("states the digest/retention policy as engine facts next to the rule manager", () => {
    render(<AlertsPage />);
    expect(screen.getByText(/at most 1 notification \/ 24h/i)).toBeInTheDocument();
    expect(screen.getByText(/KPI builder \(M6-4\/5\)/i)).toBeInTheDocument();
  });

  it("is axe-clean in the populated and empty states", async () => {
    const { rerender } = render(<AlertsPage />);
    expect((await axe(document.body)).violations).toEqual([]);
    seed({ status: "empty", alerts: [] });
    rerender(<AlertsPage />);
    expect((await axe(document.body)).violations).toEqual([]);
  });
});
