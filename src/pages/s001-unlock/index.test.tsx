import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { UnlockPage } from "./index";
import type { BridgeError } from "@/api/bridge";

/**
 * S-001 unlock — KI-013 unit: AUTH_LOCKED renders a live seconds countdown driven by
 * `retryAfterMs` (ERROR-HANDLING §A; AUTH-SPEC §2.2 "5 → 30s lockout"), submit stays
 * disabled until it expires, and the interval is cleared on unmount. The session store
 * is a mutable fixture (the store's own IPC paths are covered in session.test.ts).
 */
const { current, setStoreState, unlockMock, callMock } = vi.hoisted(() => {
  const current = {
    unlocked: false,
    status: "populated" as "loading" | "empty" | "error" | "success" | "populated",
    error: null as unknown,
    check: vi.fn(async () => undefined),
    unlock: vi.fn(async (_pin: string, _companyId: string) => true),
  };
  return {
    current,
    setStoreState: (patch: Partial<typeof current>) => Object.assign(current, patch),
    unlockMock: current.unlock,
    callMock: vi.fn(),
  };
});

vi.mock("@/stores/session", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: typeof current) => unknown) => (selector ? selector(current) : current),
    { getState: () => current },
  ),
}));

vi.mock("@/api/bridge", () => ({
  call: callMock,
}));

const COMPANIES = [{ id: "c-demo-1", name: "Meridian Holdings (Demo)" }];

function lockoutError(retryAfterMs: number | null): BridgeError {
  return {
    code: "AUTH_LOCKED",
    userMessage: "Too many attempts. Try again in 30s.",
    httpStatus: 423,
    retryable: true,
    retryAfterMs,
    details: {},
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <UnlockPage />
    </MemoryRouter>,
  );
}

async function submitPin(pin: string) {
  await userEvent.type(screen.getByLabelText("PIN"), pin);
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

beforeEach(() => {
  callMock.mockImplementation(async (command: string) => {
    if (command === "company.list") return COMPANIES;
    return {};
  });
  setStoreState({ unlocked: false, status: "populated", error: null });
});

describe("S-001 Unlock — AUTH_LOCKED countdown (KI-013)", () => {
  it("counts down in seconds from retryAfterMs and re-enables submit at 0", async () => {
    unlockMock.mockImplementation(async () => {
      setStoreState({ status: "error", error: lockoutError(3_000) });
      return false;
    });
    renderPage();
    await screen.findByText("Meridian Holdings (Demo)");

    await submitPin("WrongPin9!");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 3s.",
    );
    const submit = screen.getByRole("button", { name: "Unlock" });
    expect(submit).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Try again in 1s."), {
      timeout: 4_000,
    });
    expect(submit).toBeDisabled();

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), { timeout: 4_000 });
    // Expiry alone re-arms the form: submit unlocks again once a fresh valid PIN is entered.
    await userEvent.type(screen.getByLabelText("PIN"), "Meridian2026");
    expect(submit).toBeEnabled();
  }, 15_000);

  it("falls back to the AUTH-SPEC 30 s lock when retryAfterMs is absent", async () => {
    unlockMock.mockImplementation(async () => {
      setStoreState({ status: "error", error: lockoutError(null) });
      return false;
    });
    renderPage();
    await screen.findByText("Meridian Holdings (Demo)");

    await submitPin("WrongPin9!");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 30s.",
    );
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDisabled();
  });

  it("clears the countdown interval on unmount", async () => {
    unlockMock.mockImplementation(async () => {
      setStoreState({ status: "error", error: lockoutError(30_000) });
      return false;
    });
    const { unmount } = renderPage();
    await screen.findByText("Meridian Holdings (Demo)");
    await submitPin("WrongPin9!");
    await screen.findByRole("alert");

    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("keeps the populated unlock card axe-clean", async () => {
    renderPage();
    await screen.findByText("Meridian Holdings (Demo)");
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
