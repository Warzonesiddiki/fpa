import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPackFileObjects,
  COA_PL_SECTIONS,
  VALID_DEFAULT_METHODS,
  VALID_DRIVER_TYPES,
  type PackWizardMeta,
} from "./CustomPackWizardModal";

const META: PackWizardMeta = {
  packKey: "",
  packName: "",
  version: "",
  description: "",
  defaultCalendar: "454",
  defaultCurrency: "",
  localeHint: "",
};

const ACCOUNTS = [
  { code: "4000", name: "Sales", type: "revenue", section: "Revenue" },
  { code: "6000", name: "Payroll", type: "opex", section: "Operating Expenses" },
];

describe("buildPackFileObjects — pure 7-file pack builder (S-023 · INDUSTRY-PACK-SPEC)", () => {
  it("applies documented defaults for every empty meta field", () => {
    const out = buildPackFileObjects(META, ACCOUNTS, ["volume_x_rate"]);
    const pack = out.packJson.pack as Record<string, unknown>;
    expect(pack).toMatchObject({
      key: "custom_pack",
      name: "Custom Industry Pack",
      version: "1.0.0",
      default_calendar: "454",
      default_currency_hint: "USD",
      locale_hint: "en-US",
    });
    expect(Object.keys(out)).toEqual([
      "packJson",
      "coaJson",
      "driversJson",
      "kpisJson",
      "layoutsJson",
      "glTemplateJson",
      "rollupJson",
    ]);
  });

  it("uppercases the currency hint and keeps explicit meta verbatim", () => {
    const out = buildPackFileObjects(
      { ...META, packKey: "logistics", packName: "Logistics", defaultCurrency: "inr" },
      ACCOUNTS,
      [],
    );
    const pack = out.packJson.pack as Record<string, unknown>;
    expect(pack.key).toBe("logistics");
    expect(pack.default_currency_hint).toBe("INR");
    expect(out.rollupJson.default_currency).toBe("INR");
  });

  it("COA export carries the P&L section spine and normalized accounts (§2)", () => {
    const out = buildPackFileObjects(META, ACCOUNTS, []);
    expect(out.coaJson.sections).toEqual({ pl: [...COA_PL_SECTIONS] });
    expect(out.coaJson.accounts).toEqual([
      {
        code: "4000",
        name: "Sales",
        type: "revenue",
        section: "Revenue",
        dimensions: [],
        is_control: false,
      },
      {
        code: "6000",
        name: "Payroll",
        type: "opex",
        section: "Operating Expenses",
        dimensions: [],
        is_control: false,
      },
    ]);
  });

  it("exports only the selected driver templates with spec-valid type and method", () => {
    const out = buildPackFileObjects(META, ACCOUNTS, ["headcount_cost", "working_capital_dso"]);
    const drivers = out.driversJson.drivers as Array<{
      key: string;
      type: string;
      default_method: string;
      bounds: { low: string; high: string };
      links: unknown[];
    }>;
    expect(drivers.map((d) => d.key)).toEqual(["headcount_cost", "working_capital_dso"]);
    for (const d of drivers) {
      expect(VALID_DRIVER_TYPES).toContain(d.type);
      expect(VALID_DEFAULT_METHODS).toContain(d.default_method);
      expect(d.bounds).toEqual({ low: "0", high: "1000000000" });
      expect(d.links).toEqual([]);
    }
  });

  it("KPI export always carries formula and bands (§3)", () => {
    const out = buildPackFileObjects(META, ACCOUNTS, []);
    const kpis = out.kpisJson.kpis as Array<{
      formula: string;
      bands: { good: number; watch: number };
    }>;
    expect(kpis.length).toBeGreaterThanOrEqual(4);
    for (const kpi of kpis) {
      expect(kpi.formula).toMatch(/\S/);
      expect(typeof kpi.bands.good).toBe("number");
      expect(typeof kpi.bands.watch).toBe("number");
    }
  });

  it("layout keys are pack-scoped and the GL template documents the dump contract", () => {
    const out = buildPackFileObjects({ ...META, packKey: "breweries" }, ACCOUNTS, []);
    expect((out.layoutsJson.layouts as Array<{ key: string }>)[0].key).toBe("breweries_pl");
    expect(out.glTemplateJson.columns).toMatchObject({ amount: "signed", currency: "ISO" });
  });
});

describe("CustomPackWizardModal — 4-step flow (S-023 Pack Builder)", () => {
  const VALID_NAME = "Enterprise SaaS Growth";
  const VALID_DESC = "Subscription metrics, ARR waterfall and CAC payback focus.";
  let writeTextMock: ReturnType<typeof vi.fn>;

  async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Pack Name"), VALID_NAME);
    await user.type(screen.getByLabelText("Description"), VALID_DESC);
  }

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CustomPackWizardModalStub isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("step 1 gates Next until name ≥2, description ≥10 and semver version", async () => {
    const user = userEvent.setup();
    render(<CustomPackWizardModalStub isOpen onClose={() => {}} />);
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();

    await fillStep1(user);
    expect(next).toBeEnabled();

    // A non-semver version re-locks the gate.
    await user.clear(screen.getByLabelText("Version"));
    await user.type(screen.getByLabelText("Version"), "1.2");
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText("Version"), ".3");
    expect(next).toBeEnabled();
  });

  it("walks all four steps with COA selection, driver toggles and export review", async () => {
    const user = userEvent.setup();
    render(<CustomPackWizardModalStub isOpen onClose={() => {}} />);
    await fillStep1(user);
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Step 2: pick the SaaS starter COA, then continue.
    expect(
      screen.getByText("Select a starter Chart of Accounts structure for this pack."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /SaaS & Subscription/ }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: default drivers preselect volume × rate and headcount; toggle one off.
    await user.click(screen.getByRole("checkbox", { name: "Headcount × Average Loaded Salary" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Step 4: review shows the derived snake_case key and driver count.
    expect(
      screen.getByText("Schema-validated v1.0.0 pack manifest ready to bundle or import."),
    ).toBeVisible();
    expect(screen.getAllByText("enterprise_saas_growth").length).toBeGreaterThan(0);
    expect(screen.getByText("1 driver template(s) enabled")).toBeInTheDocument();

    // The pack.json preview embeds the sanitized key (name → snake_case).
    const preview = document.querySelector("pre")?.textContent ?? "";
    expect(preview).toContain('"key": "enterprise_saas_growth"');

    // Back returns to step 3 and Cancel closes via the host.
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("checkbox", { name: "Headcount × Average Loaded Salary" }),
    ).not.toBeChecked();
  });

  it("copy button mirrors the pack JSON into the clipboard", async () => {
    const user = userEvent.setup();
    render(<CustomPackWizardModalStub isOpen onClose={() => {}} />);
    await fillStep1(user);
    await user.click(screen.getByRole("button", { name: "4. Export Pack" }));
    await user.click(screen.getByRole("button", { name: /Export Pack JSON/i }));
    // userEvent installs its own clipboard during setup(); assert the visible
    // copied confirmation instead of the mock call.
    expect(await screen.findByText("JSON copied to clipboard!")).toBeInTheDocument();
  });
});

/** Late import so the module-level i18n setup applies before first render. */
import { CustomPackWizardModal as CustomPackWizardModalStub } from "./CustomPackWizardModal";
