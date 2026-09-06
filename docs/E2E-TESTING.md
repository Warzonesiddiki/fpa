# E2E-TESTING.md

> OneFP&A · v0.1.0 · **Playwright End-to-End Test Suite Architecture & Execution Manual (M7-5).**
> Complete guide for running, maintaining, and extending the UI E2E user journey test suite across the Tauri webview and browser preview layers. Terms per GLOSSARY.md; Zero-Compromise rules per ZERO-COMPROMISE-RULES.md.

---

## 1. ARCHITECTURE & TESTING SCOPE

The E2E test suite in `e2e/` automates core user journeys (P0 user flows per `USER-FLOWS.md`) against the application's UI surface.

Playwright runs against the built Vite preview webview parity surface (`http://127.0.0.1:4173`), testing keyboard navigation, 5 screen states (Loading, Empty, Error, Success, Populated), form interactions, and IPC data flows via the embedded mock/browser bridge layer. In native release CI pipelines, `tauri-driver` tests the compiled native Tauri binary across Windows, macOS, and Linux runners (B18-8).

### Test Suite Directory Layout

```
e2e/
├── unlock.spec.ts              # S-001 Unlock: PIN policy, wrong PIN errors, lockout countdown, success
├── company-lifecycle.spec.ts   # UF-001: Unlock -> Wizard -> Pack & Calendar -> Create -> S-010 Dashboard
├── import-gl.spec.ts           # UF-002: Import Hub (S-030) -> Map (S-031) -> Tie-Out & Commit (S-032)
├── model-planning.spec.ts      # UF-004 & UF-007: Model Grid (S-041) -> Cell edit & recalc -> Compare (S-051)
└── governance-export.spec.ts   # UF-005, UF-010, UF-014: Audit (S-070) -> Export Data Room -> Backup (S-074)
```

---

## 2. USER JOURNEYS COVERAGE MATRIX

| Spec File | Target Journey | Screen Sequence | Key Assertions & Verifications |
|---|---|---|---|
| `unlock.spec.ts` | S-001 Unlock Flow | S-001 | 5-state list, wrong PIN error, correct PIN unlock to `/app/dashboard` |
| `company-lifecycle.spec.ts` | UF-001: Company Lifecycle | S-001 → S-020 → S-002 → S-010 | Unlock with PIN → Open Wizard → Select Industry Pack & Calendar → Create Company → Land on S-010 Dashboard |
| `import-gl.spec.ts` | UF-002: GL Dump Import | S-030 → S-031 → S-032 | Select GL dump → Parse headers & encodings → Map columns / canonical template → Review Tie-Out → Commit batch |
| `model-planning.spec.ts` | UF-004 / UF-007: Planning & Scenarios | S-041 → S-051 | Select line item cell → Edit formula bar → Recalculation status & audit indicator → Scenario Compare diff inspection |
| `governance-export.spec.ts` | UF-005 / UF-010 / UF-014: Governance & Export | S-070 → S-074 | HMAC SHA-256 hash chaining verification → Export Auditor Data Room → Navigate to Backup & Restore → Create encrypted backup |

---

## 3. EXECUTION INSTRUCTIONS

### Prerequisites

- Node.js ≥ 22.0.0, npm ≥ 10.9.0
- Application dependencies installed: `npm install`
- Playwright browser binaries installed: `npx playwright install chromium`

### Running Tests

```bash
# 1. List all detected E2E tests across the suite
npx playwright test --list

# 2. Run the complete E2E test suite (automatically starts Vite preview on port 4173)
npm run test:e2e
# or directly:
npx playwright test

# 3. Run a specific user journey test
npx playwright test e2e/company-lifecycle.spec.ts
npx playwright test e2e/import-gl.spec.ts
npx playwright test e2e/model-planning.spec.ts
npx playwright test e2e/governance-export.spec.ts

# 4. Run tests with UI inspector / interactive mode
npx playwright test --ui

# 5. Run tests in headed browser mode
npx playwright test --headed

# 6. View test trace reports (retained on failure)
npx playwright show-report
```

---

## 4. DESIGN RULES & CI INVARIANTS

1. **Zero Flake Retries in CI**:
   `playwright.config.ts` sets `retries: 0` per CI-CD §6.2. Flaky tests must never be masked with retries; failures must be addressed at root cause.
2. **Accessible Role Locators**:
   Tests query elements by semantic ARIA roles, accessible names, and explicit labels (`getByRole`, `getByLabel`, `getByTestId`), never brittle CSS hierarchy selectors.
3. **No Float Representations**:
   All monetary amounts displayed in test assertions represent exact integer minor units formatted via `MoneyCell` without rounding loss (B3/B6).
4. **Deterministic Fixtures**:
   Tests use clearly-marked synthetic demo data (`assets/demo/sample_gl_dump.csv`) and deterministic test accounts, ensuring isolated and reproducible test runs.
