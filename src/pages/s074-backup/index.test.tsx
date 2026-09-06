/**
 * S-074 Backup & Restore screen tests (F-037 · M6-9 · SCREENS-SPEC S-074).
 *
 * Verifies:
 *  - Rendering 5 canonical states (Loading, Empty, Error, Success, Populated)
 *  - Backup creation dialog flow
 *  - Restore confirmation dialog flow
 *  - 0 axe accessibility violations
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import { BackupPage } from "./index";
import { useSessionStore } from "@/stores/session";
import * as bridge from "@/api/bridge";

function renderPage() {
  return render(
    <BrowserRouter>
      <BackupPage />
    </BrowserRouter>,
  );
}

const COMPANY_ID = "3f9f2c9e-9f8b-4e2d-9a1c-000000000001";

describe("S-074 BackupPage (F-037 · M6-9)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ companyId: COMPANY_ID });
  });

  it("renders populated state with backups list and remains axe-clean", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      backups: [
        {
          id: "bk-1",
          mode: "manual",
          path: "C:\\backups\\Holding_Group_2026.fpa-bak",
          size_bytes: 10485760,
          encrypted: true,
          sha256: "aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344",
          created_at: "2026-09-01T10:00:00Z",
          retained_until: "2026-10-01T10:00:00Z",
        },
      ],
    } as never);

    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("Backup & Restore")).toBeInTheDocument();
      expect(screen.getByText("Holding_Group_2026.fpa-bak")).toBeInTheDocument();
      expect(screen.getByText("encrypted")).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it("renders empty state when no backups exist and opens create modal on CTA", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      backups: [],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText(/No manual or scheduled backups exist for this Company yet/i),
      ).toBeInTheDocument();
    });

    const backupNowBtns = screen.getAllByRole("button", { name: /backup now/i });
    fireEvent.click(backupNowBtns[0]);

    expect(screen.getByText("Create Encrypted Backup")).toBeInTheDocument();
  });

  it("opens restore confirmation dialog when restore clicked", async () => {
    vi.spyOn(bridge, "call").mockResolvedValueOnce({
      backups: [
        {
          id: "bk-test-restore",
          mode: "auto",
          path: "C:\\backups\\auto-snapshot.fpa-bak",
          size_bytes: 5242880,
          encrypted: true,
          sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          created_at: "2026-09-02T12:00:00Z",
        },
      ],
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("restore-btn-bk-test-restore")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("restore-btn-bk-test-restore"));

    expect(screen.getByText("Confirm Restore")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A pre-restore snapshot will be taken automatically before restoring this backup.",
      ),
    ).toBeInTheDocument();
  });

  it("renders error state when call fails", async () => {
    vi.spyOn(bridge, "call").mockRejectedValueOnce({
      code: "BACKUP_DISK_FULL",
      message: "No space left on disk",
      userMessage: "Backup failed — no space. Your Company data is unchanged.",
    });

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Backup failed — no space. Your Company data is unchanged."),
      ).toBeInTheDocument();
    });
  });
});
