import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import HelpPage from "./index";

function renderHelp(
  options: {
    initialEntries?: string[];
    initialState?: "loading" | "empty" | "error" | "success" | "populated";
    initialTopic?: string;
  } = {},
) {
  const { initialEntries = ["/app/help"], initialState, initialTopic } = options;
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/app/help"
          element={<HelpPage initialState={initialState} initialTopic={initialTopic} />}
        />
        <Route
          path="/app/help/:topic"
          element={<HelpPage initialState={initialState} initialTopic={initialTopic} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("S-076 Help & Explainers (F-038)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading skeleton state", () => {
    const { container } = renderHelp({ initialState: "loading" });
    expect(container.querySelector('[data-screen-state="loading"]')).not.toBeNull();
    expect(screen.getByRole("status", { name: "Loading…" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Help & Explainers" }),
    ).toBeInTheDocument();
  });

  it("renders populated state with categories, topic list, and default topic details", () => {
    const { container } = renderHelp();
    expect(container.querySelector('[data-screen-state="populated"]')).not.toBeNull();

    // Title and header
    expect(
      screen.getByRole("heading", { level: 1, name: "Help & Explainers" }),
    ).toBeInTheDocument();
    expect(screen.getByText("F-038 In-App Knowledge Base")).toBeInTheDocument();

    // Category tabs
    expect(screen.getByRole("tab", { name: /All Topics/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Glossary/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Financial Formulas/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Architecture/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Shortcuts/ })).toBeInTheDocument();

    // Default active topic: OneFP&A
    expect(screen.getByRole("heading", { level: 2, name: "OneFP&A" })).toBeInTheDocument();
    expect(
      screen.getAllByText(/The application itself: a local-first desktop FP&A suite/).length,
    ).toBeGreaterThanOrEqual(1);

    // Banned synonyms notice per GLOSSARY.md
    expect(screen.getByText("Banned Synonyms:")).toBeInTheDocument();
    expect(screen.getByText(/The app, Prototype, FPA Tool/)).toBeInTheDocument();
  });

  it("filters topics dynamically via live search and shows empty state with CTA when no match", async () => {
    const user = userEvent.setup();
    const { container } = renderHelp();

    const searchInput = screen.getByRole("textbox", {
      name: /Search topics, formulas, shortcuts/i,
    });
    expect(searchInput).toBeInTheDocument();

    // Type query matching "EBITDA"
    await user.type(searchInput, "EBITDA");

    expect(
      screen.getByRole("heading", { level: 2, name: "EBITDA & Operating Margin" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mathematical Formula")).toBeInTheDocument();
    expect(screen.getAllByText(/Earnings Before Interest, Taxes/).length).toBeGreaterThanOrEqual(1);

    // Type non-matching query

    await user.clear(searchInput);
    await user.type(searchInput, "xyznonexistentsearchterm123");

    expect(container.querySelector('[data-screen-state="empty"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "No topics found" })).toBeInTheDocument();

    // Click "Clear search" CTA
    const clearBtns = screen.getAllByRole("button", { name: "Clear search" });
    await user.click(clearBtns[clearBtns.length - 1]);

    // Topics restored
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "OneFP&A" })).toBeInTheDocument();
    });
    expect(searchInput).toHaveValue("");
  });

  it("filters by category tabs (e.g. Financial Formulas)", async () => {
    const user = userEvent.setup();
    renderHelp();

    const formulasTab = screen.getByRole("tab", { name: /Financial Formulas/ });
    await user.click(formulasTab);

    // Topic list should include financial formulas
    expect(screen.getByRole("button", { name: /Variance & Attribution/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /EBITDA & Operating Margin/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Balance Sheet Tie-Out/ })).toBeInTheDocument();
  });

  it("switches to the keyboard shortcuts cheatsheet table and displays shortcuts", async () => {
    const user = userEvent.setup();
    renderHelp();

    const shortcutsTab = screen.getByRole("tab", { name: /Shortcuts/ });
    await user.click(shortcutsTab);

    expect(
      screen.getByRole("heading", { level: 2, name: "Keyboard Shortcuts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();

    // Verify key bindings in table
    expect(screen.getByText("Open Global Search (S-003)")).toBeInTheDocument();
    expect(screen.getByText("Ctrl + K")).toBeInTheDocument();
    expect(screen.getByText("⌘ + K")).toBeInTheDocument();
    expect(screen.getByText("Save Model (never blocks grid)")).toBeInTheDocument();
    expect(screen.getByText("Ctrl + S")).toBeInTheDocument();
    expect(screen.getByText("Shortcut cheat sheet (S-076)")).toBeInTheDocument();
  });

  it("renders explainer card with Definition -> Formula -> Worked Example -> Source shape", async () => {
    renderHelp({ initialTopic: "variance-attribution" });

    // Header
    expect(
      screen.getByRole("heading", { level: 2, name: "Variance & Attribution" }),
    ).toBeInTheDocument();

    // 1. Definition
    expect(screen.getByRole("heading", { level: 3, name: "Definition" })).toBeInTheDocument();
    const defElements = screen.getAllByText(
      /The arithmetic difference between two Scenario Versions/,
    );
    expect(defElements.length).toBeGreaterThanOrEqual(1);

    // 2. Mathematical Formula
    expect(
      screen.getByRole("heading", { level: 3, name: "Mathematical Formula" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Price Impact = \(Actual Price - Budget Price\) \* Actual Volume/),
    ).toBeInTheDocument();

    // 3. Worked Example
    expect(
      screen.getByRole("heading", { level: 3, name: "Practical FP&A Example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Revenue: Budget ₹38,000,000 \(100k units @ ₹380\)/),
    ).toBeInTheDocument();

    // 4. Source & Traceability
    expect(
      screen.getByRole("heading", { level: 3, name: "Source & Traceability" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/S-054 Variance Screen → Variance Attribution Engine/),
    ).toBeInTheDocument();
  });

  it("renders the error state for missing help topic with HELP_TOPIC_MISSING", () => {
    renderHelp({
      initialEntries: ["/app/help/unknown-non-existent-topic"],
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "The requested help topic was not found." }),
    ).toBeInTheDocument();
    expect(screen.getByText("HELP_TOPIC_MISSING")).toBeInTheDocument();
  });

  it("has 0 axe accessibility violations in populated state", async () => {
    renderHelp();
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });

  it("has 0 axe accessibility violations in shortcuts cheatsheet table view", async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByRole("tab", { name: /Shortcuts/ }));
    const results = await axe(document.body);
    expect(results.violations).toEqual([]);
  });
});
