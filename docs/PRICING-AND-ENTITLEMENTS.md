# PRICING-AND-ENTITLEMENTS.md

> OneFP&A · v1.0.0 · **What the license `plan` field means, what may never be paywalled, and how a gate would be built when one is decided.** Closes checklist gap #90 (`DOCUMENTATION-GAP-ANALYSIS.md` §3). **§1–§3 and §7 are normative today. §4–§5 are a decision sheet: the numbers are proposed, not ratified** — nothing may be quoted to a customer from §5 until the owner signs it off (§6).

---

## 1. WHAT EXISTS TODAY (verified in code, 2026-09-05)

| Surface | Fact | Where |
|---|---|---|
| Signed payload | `plan` is `pro` \| `enterprise`, inside the Ed25519-signed response | `LICENSE-SPEC.md` §2 |
| Storage | `licenses.plan TEXT NOT NULL CHECK ('pro','enterprise')` | `DATABASE-SCHEMA.md` (licenses) |
| Core | carried through verify → evaluate → persisted row → `session.status.license` JSON; test pins `eval.plan == "pro"` | `src-tauri/src/commands/license.rs` |
| IPC | `license.apply_response` returns `{status, plan, days_left}` | `API-SPEC.md` |
| UI | S-073 shows the plan label; zod enum optional | `src/pages/s073-license/`, `src/api/schema.ts` |
| **Enforcement** | **none** — no branch on `plan` in Rust or TS, no `entitlements` table, command, flag or store | grep-verified across `src-tauri/src` + `src` |

**Consequence:** in v1.0.0 `pro` and `enterprise` are *labels on a signed document*. Both plans unlock the identical product. Any marketing line of the form "Enterprise adds X" is a defect until X exists **and** is gated **and** §6 D3 is resolved. The only capacity limit in the suite is a correctness guard, not a commercial one: `MODEL_SIZE_LIMIT` (1M cells) — deliberately not plan-dependent.

## 2. CONSTRAINTS ANY POLICY MUST OBEY (derived from locked rules, not preference)

- **C1 — Re-licensing is expensive, so gates must be few.** There is no server (B18-9). Changing a customer's entitlements = issuing a new signed payload through the request/apply exchange (`LICENSE-SPEC.md` §1). Every gate is a manual round-trip per company per change.
- **C2 — A local gate is advisory, never a boundary.** The binary and the SQLite file belong to the customer. Gate only on a field **inside the signature** (`plan`), never on local config, and never treat an entitlement as protection for data or history: the audit chain, encryption and backup are the security boundary (`SECURITY-CHECKLIST.md`, `COMPLIANCE-DATA-SOVEREIGNTY.md`, F-033/F-037).
- **C3 — The governance floor can never be paywalled.** Exactness and traceability are the product (B-series zero-compromise rules). Never tier: money rounding, drill-to-source, audit chain and auditor export, the 5 screen states, error codes and `userMessage`s, import validation integrity, formula engine behaviour, encryption, backup/restore, **export of the customer's own data in every documented format** (no data hostage), and read-only behaviour while a license is in grace/expired.
- **C4 — One code path, like packs.** Industry is config, never per-industry code; entitlements follow the same shape: one closed key list + one evaluator, so a tier change is a table edit, not a diff through 40 components.
- **C5 — Copy has no upgrade funnel.** A gated control may say what is missing and how to obtain it, in the locked voice (`COPY-GUIDELINES.md`); it may not nag, count down, or dim a floor capability. Upsell is a human conversation in this product, because renewal is a file exchange.
- **C6 — Name the collision.** "plan" is overloaded: license **plan** (this doc), **Plan-Only mode** (F-004, no Actuals yet), and the **Plan** domain (Budget/Forecast, `app/plan/*`). New copy and identifiers must qualify the license sense as "license plan"; never rename the field or the routes (both are load-bearing).

## 3. THE MECHANISM (normative — buildable before any axis is chosen)

1. **Evaluator, Rust:** `core::entitlement::is_entitled(plan: &str, key: EntitlementKey) -> bool`, a pure function over a closed `enum EntitlementKey` with a const table of included keys per plan. No DB read, no clock, no I/O → unit-testable like `license_status`, which is pure for the same reason.
2. **Evaluator, TS:** `entitled(key)` reading the license snapshot already present in `session.status` — never a per-check IPC round-trip; exhaustive `switch` so an unknown key is a compile error, mirroring the command-registry discipline.
3. **No new wire surface.** Reuse `session.status.license` (`{status, plan, days_left}`) and `licenses.plan`. Adding a command or column would move the 97-command / 56-table ground truths in `DOCS-INDEX.md` and `FEATURE-TRACEABILITY-MATRIX.md`; an entitlement must never need a migration.
4. **Deny path is core-side.** The command refuses with a typed 403 even if the UI is bypassed (devtools, mock, script). UI locks are courtesy; the core is the truth. One test per key: "gated capability fails without the UI".
5. **One error code, and that is a spec change, not a script edit.** No catalog entry exists for "capability not licensed" (nearest: `LICENSE_EXPIRED` 403, `SESSION_LOCKED` 401 — both wrong meanings). Minting one adds to the 99-code ground truth and must land with `KNOWN-ISSUES.md` **KI-015** resolved, so the widened code check can actually catch a typo. Blocked on owner decision **D3**.
6. **Ship the seam, not the switch (v1.0.0 recommendation).** Land the evaluator with the table returning *true for every key on both plans*, plus its tests and the empty `EntitlementKey` list. That is honest: it documents the decision point, costs no behaviour change, touches no gate, and makes the later policy edit a table row instead of an architecture change.
7. **Grace/expired is orthogonal.** `LICENSE-SPEC.md` §6 records that write-time read-only enforcement is still open (TASKBOARD M1-4). That fix is owed regardless of any pricing decision, and is not an entitlement mechanism — do not smuggle it into this one.

## 4. AXIS SHEET (each axis: the option, its cost, the recommendation)

| Axis | Candidate rule | Cost / risk | Recommendation |
|---|---|---|---|
| Service tier | Enterprise = response-time target, guided first pack, migration help, named contact | zero code, zero gate, no C1 friction | **Yes — the v1.0.0 answer.** Sell attention, not switches |
| Deferred modules | V-004 valuation/M&A, V-021 lease, V-022 tax provision, V-023 ESG, V-027 governance suite, V-002/V-018 simulation | needs §3 + D3 deny path; each new gate is a re-licence (C1) | **The only future software gate.** Decide at v1.1, per module, max 3 keys |
| Extra connectors | V-005 HRIS/CRM connectors Enterprise-only; the 4 ERP connectors stay in both | connectors are adapters (config-driven); gating them contradicts nothing | Keep for v1.1 alongside modules |
| Live FX feeds | V-008 optional feeds | the only network-adjacent affordance | Free in both — charging for a feed we do not operate is a liability |
| Company count / group size | cap companies or entities per plan | no cap exists in any spec today; introducing one is a promise withdrawal vs `PROJECT-BRIEF.md` | **Never.** Unlimited companies |
| Seats / users | per-user pricing | breaks the structural differentiator in `COMPETITIVE-ANALYSIS.md` §2 and B1 single-user desktop | **Never.** Per Company File only |
| Data volume / export | limit rows, exports, formats | violates C3 (data hostage) and the traceability promise | **Never** |
| Audit & governance depth | metered audit retention, paid drill-down | violates C3 outright | **Never** |
| Update channel | hold security patches off Pro | violates B-series trust rules; the updater channels in `DEPLOYMENT.md` are a user choice in S-075, not a tier | **Never** |

## 5. PRICING (PROPOSED · owner ratification required before external use)

Method, not guesswork: anchor on the **avoided implementation cost** in `COMPETITIVE-ANALYSIS.md` §2 (cloud Y1 $30K–$250K platform **plus** $40K–$150K services, 2–6 months), not on our cost base; price against the $0 incumbent (Excel) on *control lost*, never on features; keep one number per company so a quote is not a negotiation; and market it as "you never gate a reviewer", not as "cheap".

| Offer | Target | Proposed annual, per Company File | Basis |
|---|---|---|---|
| Evaluation | any | $0, 60 days, full capability, expiry via the signed `expires_at` | no trial infrastructure needed — the payload already carries expiry |
| **Pro** | $5M–$100M revenue, single BU (Priya/Ravi entry) | low-five figures flat | ≈ 1 analyst-month of cloud licence + implementation avoided |
| **Enterprise** | $50M–$500M, multi-BU / audit-heavy | Pro + service tier now; + module unlocks at v1.1 | flat per Company File, **not** per seat (positioning) |

Structure to ratify with the numbers: annual subscription for updates + support; **perpetual-use grace** — a lapsed license drops to read-only with full export, never to data lockout (C3); 24-month and 36-month prepay discounts to absorb C1's re-licence friction; no volume tiers (per-Company licensing means a bigger company is a second license, priced identically); education/nonprofit and startup-plan-only paths exist at the vendor's discretion, since plan-only mode already ships for pre-revenue teams.

## 6. OPEN DECISIONS (owner · each names the files it edits)

- **D1** Ratify or restate §5 numbers → this doc + `README.md`/marketing copy.
- **D2** Ratify the axis recommendations in §4 (which keys may ever exist) → this doc §3.1 `EntitlementKey` list.
- **D3** Approve one deny-path error code + `userMessage` → `ERROR-HANDLING.md` §2 (**99 → 100**, so `DOCS-INDEX.md`, `FEATURE-TRACEABILITY-MATRIX.md` and the `docs:verify` claim move together) and land with KI-015.
- **D4** Confirm the v1.1 module set is where any software gate will live → `ROADMAP.md`, `PRD.md` V-table notes.
- **D5** Confirm annual-vs-perpetual shape (§5) → `DECISIONS.md` ADR when ratified.

Until D1–D5 close, **§7 binds**, and this file is a specification of the seam plus a decision sheet — not a price list.

## 7. INTERIM RULES (in force now)

1. No branching on `plan` in any component, store, command or pack. The evaluator stub (§3.6) is the only place the concept may be named.
2. S-073 renders the plan label verbatim from the payload; no tier adjectives, no "upgrade" CTA, no lock icons.
3. No doc, release note or site copy may claim a capability is Pro-only or Enterprise-only.
4. `licenses.plan` CHECK, the zod enum and the payload field stay exactly as they are — the seam needs no schema work.
5. Anything in §4 marked *Never* stays out of scope for every future version, not just v1.0.0.

## 8. VERIFICATION LOG (how §1 was established, so a reviewer can re-run it)

`grep -rn 'plan ==\|"pro"\|"enterprise"' src-tauri/src src` → only fixture assertions, mock normalisation, schemas and S-073 display; no conditional behaviour. `grep -rn "entitle" docs src src-tauri` → no hits outside this file. Cap search across specs → `MODEL_SIZE_LIMIT` only. Every code name cited here appears in `ERROR-HANDLING.md` §2 except the one §3.5 explicitly records as missing.

*Referenced by: LICENSE-SPEC.md, PRD.md, COMPETITIVE-ANALYSIS.md, ZERO-COMPROMISE-RULES.md, DOCUMENTATION-GAP-ANALYSIS.md, DOCS-INDEX.md.*
