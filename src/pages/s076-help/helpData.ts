export type HelpCategory = "glossary" | "shortcuts" | "formulas" | "architecture" | "errors";

export interface ShortcutItem {
  id: string;
  action: string;
  keysWinLinux: string;
  keysMac: string;
  context: string;
}

export interface ExplainerTopic {
  id: string;
  title: string;
  category: HelpCategory;
  definition: string;
  formula?: string;
  example?: string;
  source?: string;
  notes?: string;
  synonymsBanned?: string[];
  relatedShortcuts?: ShortcutItem[];
  tags: string[];
}

export const SHORTCUTS_DATA: ShortcutItem[] = [
  {
    id: "global-search",
    action: "Open Global Search (S-003)",
    keysWinLinux: "Ctrl + K",
    keysMac: "⌘ + K",
    context: "Global",
  },
  {
    id: "save-model",
    action: "Save Model (never blocks grid)",
    keysWinLinux: "Ctrl + S",
    keysMac: "⌘ + S",
    context: "Model Grid",
  },
  {
    id: "undo-redo",
    action: "Undo / Redo",
    keysWinLinux: "Ctrl + Z / Ctrl + Y",
    keysMac: "⌘ + Z / ⌘ + Shift + Z",
    context: "Global / Grid",
  },
  {
    id: "copy-paste",
    action: "Copy / Paste (Excel-compatible)",
    keysWinLinux: "Ctrl + C / Ctrl + V",
    keysMac: "⌘ + C / ⌘ + V",
    context: "Model Grid",
  },
  {
    id: "edit-cell",
    action: "Edit active cell",
    keysWinLinux: "F2",
    keysMac: "F2",
    context: "Model Grid",
  },
  {
    id: "cancel-close",
    action: "Close modal / drawer; cancel edit",
    keysWinLinux: "Esc",
    keysMac: "Esc",
    context: "Global",
  },
  {
    id: "move-focus",
    action: "Move focus between cells / controls",
    keysWinLinux: "Tab / Shift + Tab",
    keysMac: "Tab / Shift + Tab",
    context: "Global",
  },
  {
    id: "commit-cell",
    action: "Commit cell / activate selected button",
    keysWinLinux: "Enter",
    keysMac: "Return",
    context: "Global / Grid",
  },
  {
    id: "cell-navigation",
    action: "Cell navigation (Excel parity)",
    keysWinLinux: "↑ / ↓ / ← / →",
    keysMac: "↑ / ↓ / ← / →",
    context: "Model Grid",
  },
  {
    id: "find-in-sheet",
    action: "Find in sheet",
    keysWinLinux: "Ctrl + F",
    keysMac: "⌘ + F",
    context: "Model Grid",
  },
  {
    id: "screen-help",
    action: "Help for current screen",
    keysWinLinux: "F1",
    keysMac: "F1",
    context: "Global",
  },
  {
    id: "shortcuts-sheet",
    action: "Shortcut cheat sheet (S-076)",
    keysWinLinux: "? (Shift + /)",
    keysMac: "? (Shift + /)",
    context: "Global",
  },
];

export const HELP_TOPICS: ExplainerTopic[] = [
  // 1. GLOSSARY (Mirroring GLOSSARY.md)
  {
    id: "onefpa",
    title: "OneFP&A",
    category: "glossary",
    definition:
      "The application itself: a local-first desktop FP&A suite for Windows, macOS, Linux.",
    source: "Desktop runtime · Local SQLite / Argon2id / AES-256-GCM",
    notes:
      "Rule B9: All brand strings live in one config file. Zero cloud telemetry or data leakage.",
    synonymsBanned: ["The app", "Prototype", "FPA Tool", "FinPlan", "Suite"],
    tags: ["product", "desktop", "local-first", "core"],
  },
  {
    id: "company",
    title: "Company",
    category: "glossary",
    definition:
      "The highest-level container in the app; a single legal/economic entity set owned by one user. A Company has one Group Calendar view, one Chart of Accounts structure, and can own multiple Business Units.",
    source: "Company File (.fpa) → SQLite `companies` table → S-020 Companies screen",
    notes: "Never use banned terms like Workspace, Tenant, or Org.",
    synonymsBanned: ["Workspace", "Tenant", "Organization", "Org", "Portfolio"],
    tags: ["structure", "entity", "container"],
  },
  {
    id: "company-file",
    title: "Company File (.fpa)",
    category: "glossary",
    definition:
      "A .fpa file on disk containing one encrypted Company (schema, data, packs, audit chain).",
    source: "Local filesystem storage → AES-256-GCM encryption",
    notes: "Encrypted at rest using Argon2id derived key.",
    synonymsBanned: ["Project file", "Database file", "Save file"],
    tags: ["storage", "encryption", "file"],
  },
  {
    id: "business-unit",
    title: "Business Unit (BU)",
    category: "glossary",
    definition:
      "A reporting/operating unit inside a Company that owns its own Industry Pack, calendar variant, currency, Chart of Accounts subset, and scenario drivers. One BU = one consolidation 'leaf' and (if owned) one legal subsidiary.",
    source: "DB `business_units` table → S-020 Companies & BU hierarchy",
    synonymsBanned: ["Entity", "Division", "Department", "Legal Entity", "Section", "Segment"],
    tags: ["consolidation", "hierarchy", "subsidiary"],
  },
  {
    id: "model",
    title: "Model",
    category: "glossary",
    definition:
      "The user's editable planning artifact inside a Company: a set of Sheets, Driver Tables, Assumption Register entries, Report Layouts, and Scenarios, scoped to a planning horizon.",
    source: "DB `models` table → S-041 Model Grid & Calculation Engine",
    synonymsBanned: ["Workbook", "Model file", "Planning file", "Spreadsheet"],
    tags: ["planning", "formulas", "grid"],
  },
  {
    id: "sheet",
    title: "Sheet",
    category: "glossary",
    definition:
      "A named tab within a Model (e.g., Revenue, Headcount, Capex, Cash). Sheets reference each other by name.",
    source: "DB `sheets` table → HyperFormula Sheet instance",
    synonymsBanned: ["Grid", "Worksheet", "Tab", "Page"],
    tags: ["grid", "tabs", "references"],
  },
  {
    id: "industry-pack",
    title: "Industry Pack",
    category: "glossary",
    definition:
      "Versioned configuration data (JSON + SQL seed) that adapts the generic engine to one industry: Chart of Accounts template, KPI definitions, Driver Templates, Report Layouts, calendar preset. Packs are data, never code (rule B15).",
    source: "JSON pack definitions → S-023 Packs screen",
    synonymsBanned: ["Sector pack", "Vertical", "Industry module", "Template pack"],
    tags: ["packs", "config", "coa"],
  },
  {
    id: "fiscal-calendar",
    title: "Fiscal Calendar",
    category: "glossary",
    definition:
      "The configured time structure of a Company/BU: start month, period type (calendar month, 4-5-4, 4-4-5, 5-4-4, 3-3-3-4 / 13-period), week start day, 52/53-week rules.",
    source: "Calendar Engine → S-022 Calendar screen",
    notes:
      "Daylight Rule: period boundaries are computed from the Fiscal Calendar only; timezone/DST never alters a period boundary.",
    synonymsBanned: ["Accounting calendar", "Retail calendar", "Fiscal year config"],
    tags: ["calendar", "time", "periods"],
  },
  {
    id: "chart-of-accounts",
    title: "Chart of Accounts (COA)",
    category: "glossary",
    definition:
      "The hierarchical list of Accounts used by a Company/BU, with types (Revenue, COGS, Opex, Asset, Liability, Equity) and report-section mapping.",
    source: "DB `accounts` table → S-021 Chart of Accounts",
    synonymsBanned: ["Account tree", "GL structure", "Account list"],
    tags: ["accounts", "gl", "hierarchy"],
  },
  {
    id: "gl-line",
    title: "GL Line",
    category: "glossary",
    definition:
      "A single normalized row of Actuals: Fiscal Period, Account, Dimension Values, Amount (decimal string), Source, Posting Reference, Currency, plus import metadata.",
    source: "DB `gl_lines` table → Manual Import or Connector pipeline",
    synonymsBanned: ["Transaction", "Journal line", "Row", "Record"],
    tags: ["gl", "actuals", "import"],
  },
  {
    id: "actuals",
    title: "Actuals",
    category: "glossary",
    definition:
      "Committed financial data for occurred periods, in Versioned Import Batches. Invariant I3: Actuals are never edited in place.",
    source: "DB `import_batches` & `gl_lines` → Statements & Variance screens",
    synonymsBanned: ["Live data", "Actual"],
    tags: ["actuals", "batches", "immutability"],
  },
  {
    id: "budget",
    title: "Budget",
    category: "glossary",
    definition:
      "A committed plan for a defined Fiscal Year, built from a Planning Method; the baseline against which Actuals are analyzed.",
    source: "Scenario Manager (S-050) → Approved Baseline Version",
    notes:
      "Invariant I2: A Budget is one Fiscal Year, committed; a Forecast is rolling; they are never confused.",
    synonymsBanned: ["Annual plan", "Plan", "Draught"],
    tags: ["budget", "baseline", "planning"],
  },
  {
    id: "forecast",
    title: "Forecast",
    category: "glossary",
    definition:
      "An updated projection of remaining periods and beyond (rolling or fixed), built from drivers and Actuals; not a commitment.",
    source: "S-050 Scenarios / S-053 Planning Cycle",
    synonymsBanned: ["Projection", "Estimate"],
    tags: ["forecast", "rolling", "projection"],
  },
  {
    id: "scenario",
    title: "Scenario",
    category: "glossary",
    definition:
      "A distinct, user-named set of Assumptions, Drivers, and inputs under one Model (e.g., Base, Upside, Downside, Recession). Scenarios share the Model structure.",
    source: "DB `scenarios` table → S-050 Scenarios screen",
    synonymsBanned: ["Version", "Case", "What-if", "Alternative"],
    tags: ["scenario", "planning", "whatif"],
  },
  {
    id: "version",
    title: "Version",
    category: "glossary",
    definition:
      "An immutable snapshot of any Scenario at a point in time (created automatically on lock/export/import or manually). Diffable, auditable.",
    source: "DB `scenario_versions` table → S-051 Compare screen",
    synonymsBanned: ["Snapshot"],
    tags: ["version", "snapshot", "immutable"],
  },
  {
    id: "audit-trail",
    title: "Audit Trail",
    category: "glossary",
    definition:
      "Immutable, HMAC-chained event log of all changes (who, what, when, before/after, imports, approvals, exports).",
    source: "DB `audit_events` table → S-070 Audit Trail screen",
    notes:
      "Tamper-evident chain: if any event hash fails verification, the app enters persistent read-only mode.",
    synonymsBanned: ["Change log"],
    tags: ["audit", "hmac", "governance", "security"],
  },
  {
    id: "money-value",
    title: "Money Value",
    category: "glossary",
    definition:
      "Any financial amount: represented internally as integer minor units or decimal strings; never IEEE-754 float across the IPC boundary (rule B18-2 / Invariant I1).",
    source: "Money Engine (`src/utils/money.ts`)",
    notes:
      "Scale factor: Currency Scale specifies minor-unit digits (USD = 2, JPY = 0, KWD = 3). Exact integer arithmetic.",
    synonymsBanned: ["Amount", "Currency value"],
    tags: ["money", "minor-unit", "precision", "exact"],
  },

  // 2. FINANCIAL FORMULAS & KPIS
  {
    id: "variance-attribution",
    title: "Variance & Attribution",
    category: "formulas",
    definition:
      "The arithmetic difference between two Scenario Versions (Actuals vs Budget/Forecast), decomposed into Price, Volume, Mix, and FX components.",
    formula:
      "Variance = Actual - Baseline\nPrice Impact = (Actual Price - Budget Price) * Actual Volume\nVolume Impact = (Actual Volume - Budget Volume) * Budget Price",
    example:
      "Revenue: Budget ₹38,000,000 (100k units @ ₹380) vs Actual ₹42,000,000 (105k units @ ₹400).\nPrice Impact = (₹400 - ₹380) * 105,000 = ₹2,100,000 favorable.\nVolume Impact = (105,000 - 100,000) * ₹380 = ₹1,900,000 favorable.\nTotal Revenue Variance = ₹4,000,000 favorable (10.5%).",
    source: "S-054 Variance Screen → Variance Attribution Engine",
    notes:
      "Favorable/Unfavorable direction is determined relative to account type (Revenue higher is Favorable; Cost higher is Unfavorable).",
    synonymsBanned: ["Deviation", "Gap", "Positive/negative"],
    tags: ["variance", "attribution", "price", "volume"],
  },
  {
    id: "ebitda",
    title: "EBITDA & Operating Margin",
    category: "formulas",
    definition:
      "Earnings Before Interest, Taxes, Depreciation, and Amortization: core operating profitability proxy before non-cash and capital structure items.",
    formula:
      "Gross Profit = Revenue - COGS\nEBITDA = Gross Profit - OpEx\nEBIT = EBITDA - Depreciation - Amortization\nOperating Margin % = (EBITDA / Revenue) * 100",
    example:
      "Oracle P&L Basic (TEST-FIXTURES-SPEC §3):\nRevenue: 6,350,000.00\nCOGS: 3,970,000.00 → Gross Profit: 2,380,000.00\nOpEx: 1,240,000.00 → EBITDA: 1,140,000.00 (18.0% margin)\nDepreciation: 250,000.00 → EBIT: 890,000.00\nTax @ 22%: 195,800.00 → Net Income: 694,200.00",
    source: "S-060 Statement Suite (P&L) → Statement Engine",
    tags: ["p&l", "ebitda", "margin", "oracle"],
  },
  {
    id: "balance-sheet-tieout",
    title: "Balance Sheet Tie-Out",
    category: "formulas",
    definition:
      "The fundamental accounting equilibrium test verifying that Total Assets exactly equal Total Liabilities plus Equity across all reporting periods.",
    formula:
      "Total Assets = Current Assets + Non-Current Assets\nTotal Liabilities = Current Liabilities + Non-Current Liabilities\nEquity = Retained Earnings + Paid-in Capital + OCI\nDelta = Total Assets - (Total Liabilities + Equity) === 0",
    example:
      "Oracle BS Basic (TEST-FIXTURES-SPEC §3):\nCash: 1,320,000.00, AR: 2,100,000.00, Inv: 1,150,000.00, Fixed: 4,200,000.00 → Assets: 8,770,000.00\nAP: 1,950,000.00, Debt: 5,000,000.00 → Liabilities: 6,950,000.00\nEquity: 1,820,000.00 → Liabilities + Equity: 8,770,000.00\nTie-Out Delta = 0.00 (Passed)",
    source: "S-060 Balance Sheet / S-071 Health Check",
    notes: "A non-zero delta immediately triggers a blocking HARD validation error.",
    synonymsBanned: ["Balancing", "Statement of financial position"],
    tags: ["balance-sheet", "tie-out", "assets", "liabilities"],
  },
  {
    id: "cash-flow-indirect",
    title: "Cash Flow Statement (Indirect Method)",
    category: "formulas",
    definition:
      "Cash generation reconciled from Net Income by adjusting for non-cash expenses, working capital shifts, capex, and financing movements.",
    formula:
      "Operating CF (OCF) = Net Income + Non-Cash (Depr) - Δ Working Capital\nFree Cash Flow (FCF) = OCF - Capex (ICF)\nNet Cash Delta = OCF + ICF + FCF_Financing\nEnding Cash = Beginning Cash + Net Cash Delta",
    example:
      "Oracle CF Basic (TEST-FIXTURES-SPEC §3):\nOperating Cash Flow: 1,480,000.00\nInvesting Cash Flow: -640,000.00 → Free Cash Flow: 840,000.00\nFinancing Cash Flow: -520,000.00\nNet Cash Change = 320,000.00 (exact match to BS cash line delta)",
    source: "S-060 Cash Flow Statement → Statement Engine",
    tags: ["cash-flow", "fcf", "ocf", "indirect"],
  },
  {
    id: "fva-mape",
    title: "FVA & Forecast Accuracy (MAPE)",
    category: "formulas",
    definition:
      "Forecast Value Added: scoring historical forecast quality against actualized outcomes to determine whether planning steps add predictive accuracy or noise.",
    formula:
      "MAPE = (1 / n) * Σ (|Actual_t - Forecast_t| / |Actual_t|) * 100\nForecast Bias = (1 / n) * Σ (Forecast_t - Actual_t)\nFVA = MAPE(Naive Baseline) - MAPE(Proposed Forecast)",
    example:
      "Actual Q1-Q3 Revenue: ₹10M, ₹12M, ₹11M.\nForecast Q1-Q3: ₹9.5M (err 5%), ₹12.6M (err 5%), ₹11.55M (err 5%).\nMAPE = 5.0%. Positive FVA indicates the planning cycle improved over a naive historical run rate.",
    source: "S-055 FVA Screen → Analysis Functions",
    notes:
      "FVA identifies process steps that consume management hours without improving forecast accuracy.",
    tags: ["fva", "mape", "forecast", "accuracy"],
  },
  {
    id: "cagr",
    title: "CAGR (Compound Annual Growth Rate)",
    category: "formulas",
    definition:
      "The geometric annualized growth rate of an investment, revenue line, or KPI over a multi-period horizon.",
    formula: "CAGR = (Ending Value / Beginning Value) ^ (1 / n) - 1",
    example:
      "FY23 Revenue = ₹5,000,000; FY26 Revenue = ₹8,640,000 (n = 3 years).\nCAGR = (8,640,000 / 5,000,000) ^ (1/3) - 1 = (1.728) ^ 0.3333 - 1 = 1.20 - 1 = 20.0%",
    source: "Analysis Functions → HyperFormula Custom Evaluation",
    tags: ["cagr", "growth", "formulas", "analysis"],
  },
  {
    id: "rounding-allocation",
    title: "Rounding Rule & Largest-Remainder Allocation",
    category: "formulas",
    definition:
      "Algorithm that distributes display-rounding residuals so every report subtotal and consolidated parent sums exactly to the unrounded total at every level.",
    formula:
      "Display Minor Unit = Round(Raw, Scale, HALF_UP)\nResidual = Unrounded Total - Sum(Rounded Parts)\nAllocate +1/-1 minor unit to parts with largest fractional remainder.",
    example:
      "Three lines of 33.333% share on ₹100:\nRaw: 33.333, 33.333, 33.334. Standard rounding gives 33.33 + 33.33 + 33.33 = 99.99.\nLargest-remainder distributes +0.01 to highest fraction → 33.33 + 33.33 + 33.34 = 100.00 exact.",
    source: "Statement Engine (`src/utils/money.ts` §Largest-Remainder)",
    notes: "Invariant I8: Every report total sums exactly. Never display broken column arithmetic.",
    synonymsBanned: ["Rounding", "Proportional rounding"],
    tags: ["rounding", "largest-remainder", "money", "invariants"],
  },

  // 3. ARCHITECTURE & SECURITY
  {
    id: "security-pin-keychain",
    title: "PIN, Encryption & Credential Store",
    category: "architecture",
    definition:
      "Three-tier local security: User PIN (Argon2id) unlocks AES-256-GCM Company File keys, with OS Credential Store (Windows Credential Manager / macOS Keychain / Secret Service) isolating third-party tokens.",
    formula:
      "Key = Argon2id(PIN, Salt, m=64MB, t=3, p=4)\nCiphertext = AES-256-GCM(Key, Nonce, PlaintextDB)",
    example:
      "First run generates 12-word Recovery Phrase. Entering correct PIN restores AES-256-GCM master key in RAM; tokens never cross IPC to UI layer.",
    source: "Rust Core `src-tauri/security` → S-001 Unlock & First Run PIN",
    notes: "No master backdoor, zero cloud key escrow. User owns their encryption keys entirely.",
    synonymsBanned: ["Password", "Secret store", "Vault"],
    tags: ["security", "pin", "keychain", "argon2id"],
  },
  {
    id: "ipc-money-contract",
    title: "IPC Money Boundary Contract",
    category: "architecture",
    definition:
      "Tauri IPC architecture boundary rule B18-2 / Invariant I1: Financial values never cross the IPC boundary as IEEE-754 floating point numbers.",
    formula:
      "Valid IPC Payloads: { amount_minor: 125000, scale: 2 } OR { amount_str: '1250.00' }\nInvalid: { amount: 1250.0 } (Rejected at schema validation)",
    example:
      "A balance of $1,250.50 crosses as integer 125050 cents with currency scale 2. This guarantees zero 0.1 + 0.2 = 0.30000000000000004 floating point errors.",
    source: "IPC Bridge (`src/api/bridge.ts`) · Money Types (`src/types/money.ts`)",
    tags: ["ipc", "architecture", "precision", "floating-point"],
  },
  {
    id: "tamper-evident-chain",
    title: "Tamper-Evident HMAC Audit Chain",
    category: "architecture",
    definition:
      "Cryptographic event log where each action generates a SHA-256 HMAC incorporating the previous block's hash, timestamp, actor, and payload diff.",
    formula: "Hash_n = HMAC-SHA256(SecretKey, Hash_{n-1} + Timestamp + EventType + PayloadHash)",
    example:
      "On startup, S-070 / S-071 traverses all events from genesis to tip. If any intermediate record is altered in SQLite directly, verification fails and triggers persistent Read-Only mode.",
    source: "DB `audit_events` → Rust HMAC Engine → S-004 Shell Alert",
    tags: ["hmac", "audit", "blockchain-style", "integrity"],
  },
  {
    id: "hyperformula-engine",
    title: "Formula Recalculation Engine",
    category: "architecture",
    definition:
      "Dependency-graph-driven spreadsheet calculation engine providing high-speed incremental recalculation and cycle detection (#CYCLE!).",
    source: "HyperFormula web-worker / native calculation bridge",
    notes: "Cycles are surfaced with the exact dependency loop path — never silently computed.",
    tags: ["hyperformula", "formulas", "dependency-graph", "calc"],
  },
];
