import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PacksPage } from "./index";

const callMock = vi.fn();
vi.mock("@/api/bridge", () => ({ call: (...args: unknown[]) => callMock(...args) }));

const PACKS = [
  { key: "saas", name: "SaaS / Tech", version: "2.1.0", schema_version: "1.0.0", is_bundled: true },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/app/model/packs"]}>
      <Routes>
        <Route path="/app/model/packs" element={<PacksPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-023 Pack Studio — typed error surface (B12)", () => {
  beforeEach(() => callMock.mockReset());

  it("shows the PACK_SCHEMA_INVALID error state with retry", async () => {
    callMock.mockRejectedValueOnce({
      code: "PACK_SCHEMA_INVALID",
      userMessage: "The Pack library could not be loaded.",
      httpStatus: 422,
      retryable: false,
      retryAfterMs: null,
      details: { field: "pack.schema_version" },
    });
    renderPage();
    expect(await screen.findByText("The Pack library could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("PACK_SCHEMA_INVALID")).toBeInTheDocument();

    callMock.mockResolvedValue(PACKS);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /SaaS \/ Tech/ })).toBeInTheDocument();
  });
});
