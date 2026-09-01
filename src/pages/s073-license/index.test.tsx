import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LicensePage } from "./index";
import { useSessionStore } from "@/stores/session";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const COMPANY_ID = "11111111-2222-3333-4444-555555555555";

// NOTE: the mocked `call` returns the UNWRAPPED data (the real bridge strips the
// `{data}` envelope before resolving), so queues carry the inner shapes.
function statusResult(license: unknown) {
  return {
    unlocked: true,
    company_id: COMPANY_ID,
    model_id: null,
    read_only: false,
    license,
  };
}

/** Queue positional results (last one repeats); objects resolve, Rejected rejects. */
class Rejected {
  constructor(readonly value: unknown) {}
}
function queue(...results: unknown[]) {
  callMock.mockReset();
  let i = 0;
  callMock.mockImplementation(() => {
    const next = results[Math.min(i++, results.length - 1)];
    if (next instanceof Rejected) return Promise.reject(next.value);
    return Promise.resolve(next);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/governance/license"]}>
      <Routes>
        <Route path="/app/governance/license" element={<LicensePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ACTIVE_LICENSE = {
  status: "active",
  days_left: 365,
  plan: "pro",
  expires_at: "2099-12-31T23:59:59Z",
  license_key_id: "LK-TEST-VALID-0001",
  machine_fingerprint: "fp-c2860307d791f8c906d07dff32e4db81",
};

describe("S-073 License & Activation (F-035)", () => {
  beforeEach(() => {
    useSessionStore.setState({ companyId: COMPANY_ID, unlocked: true });
  });

  it("shows the loading skeleton until session.status answers", async () => {
    queue(new Promise(() => {})); // never settles
    renderPage();
    expect(screen.getByRole("status", { name: /Loading/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "License & Activation" })).toBeInTheDocument();
  });

  it("empty state: no license row → 'Not activated' with the activation surface", async () => {
    queue(statusResult(null));
    renderPage();
    expect(await screen.findByText("Not activated")).toBeInTheDocument();
    expect(screen.getByText(/No license found for this Company/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply license" })).toBeDisabled();
    // Request file generator is available in the empty state
    expect(screen.getByRole("button", { name: "Generate request file" })).toBeEnabled();
  });

  it("populated state: active license shows badge, plan, expiry, key id and fingerprint", async () => {
    queue(statusResult(ACTIVE_LICENSE));
    renderPage();
    expect(await screen.findByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("LK-TEST-VALID-0001")).toBeInTheDocument();
    expect(screen.getByText("fp-c2860307d791f8c906d07dff32e4db81")).toBeInTheDocument();
    expect(screen.getByText("2099-12-31T23:59:59Z")).toBeInTheDocument();
  });

  it("grace state shows the countdown warning", async () => {
    queue(statusResult({ ...ACTIVE_LICENSE, status: "grace", days_left: 12 }));
    renderPage();
    expect(await screen.findByText("Grace period")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("12 days remaining");
  });

  it("expired state shows the read-only notice", async () => {
    queue(statusResult({ ...ACTIVE_LICENSE, status: "expired", days_left: 0 }));
    renderPage();
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(
      screen.getByText("License expired. The Company is read-only. Activate to continue."),
    ).toBeInTheDocument();
  });

  it("manual code entry: applies the pasted payload and re-reads the live status", async () => {
    const user = userEvent.setup();
    queue(
      statusResult(null),
      {
        status: "active",
        plan: "pro",
        days_left: 365,
      },
      statusResult(ACTIVE_LICENSE),
    );
    renderPage();
    await screen.findByText("Not activated");
    await user.click(screen.getByRole("tab", { name: "Manual code entry" }));
    const payload = JSON.stringify(ACTIVE_LICENSE);
    // paste (not type): userEvent parses `{`/`}` as keyboard key syntax; paste targets the
    // focused element, so focus the textarea first
    const ta = screen.getByLabelText(/Paste the license response/);
    ta.focus();
    await user.paste(payload);
    await user.click(screen.getByRole("button", { name: "Apply license" }));
    expect(await screen.findByText(/Activated \(active\)/)).toBeInTheDocument();
    const applyCalls = callMock.mock.calls.filter((c) => c[0] === "license.apply_response");
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0][1]).toEqual({ response_path_or_payload: payload });
  });

  it("apply failure surfaces the locked error code and user text", async () => {
    const user = userEvent.setup();
    queue(
      statusResult(null),
      new Rejected({
        code: "LICENSE_INVALID_SIGNATURE",
        userMessage: "This license key is invalid. Contact your vendor.",
        httpStatus: 403,
        retryable: false,
        retryAfterMs: null,
        details: {},
      }),
    );
    renderPage();
    await screen.findByText("Not activated");
    await user.click(screen.getByRole("tab", { name: "Manual code entry" }));
    const ta2 = screen.getByLabelText(/Paste the license response/);
    ta2.focus();
    await user.paste('{"broken":true}');
    await user.click(screen.getByRole("button", { name: "Apply license" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("LICENSE_INVALID_SIGNATURE");
    expect(alert).toHaveTextContent("This license key is invalid. Contact your vendor.");
  });

  it("file entry: a picked license file loads its contents into the payload", async () => {
    const user = userEvent.setup();
    queue(statusResult(null));
    renderPage();
    await screen.findByText("Not activated");
    const input = screen.getByLabelText("Choose a license file");
    await user.upload(
      input,
      new File([JSON.stringify(ACTIVE_LICENSE)], "license.json", { type: "application/json" }),
    );
    expect(await screen.findByText("license.json")).toBeInTheDocument();
    // FileReader resolves async → the payload arrives, and the Apply button unlocks.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply license" })).toBeEnabled(),
    );
  });

  it("request file: resolves the active Company path and shows the generated file", async () => {
    const user = userEvent.setup();
    queue(
      statusResult(null),
      [
        {
          id: COMPANY_ID,
          name: "Fixture Co",
          company_file_path: "/tmp/fixture-co.onfpa",
        },
      ],
      { file: "/tmp/fixture-co.onfpa.license-request.json" },
    );
    renderPage();
    await screen.findByText("Not activated");
    await user.click(screen.getByRole("button", { name: "Generate request file" }));
    expect(
      await screen.findByText("/tmp/fixture-co.onfpa.license-request.json"),
    ).toBeInTheDocument();
    const requestCalls = callMock.mock.calls.filter((c) => c[0] === "license.request_file");
    expect(requestCalls).toHaveLength(1);
    expect(requestCalls[0][1]).toEqual({ company_path: "/tmp/fixture-co.onfpa" });
  });

  it("screen-level error: load failure offers retry and recovers", async () => {
    const user = userEvent.setup();
    queue(
      new Rejected({
        code: "INTERNAL",
        userMessage: "An unexpected error occurred. Please try again.",
        httpStatus: 500,
        retryable: true,
        retryAfterMs: null,
        details: {},
      }),
      statusResult(ACTIVE_LICENSE),
    );
    renderPage();
    expect(await screen.findByRole("status", { name: /Error/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Valid")).toBeInTheDocument();
  });
});
