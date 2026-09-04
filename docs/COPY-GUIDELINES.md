# COPY-GUIDELINES.md

> OneFP&A · v1.0.0 · Terms per GLOSSARY.md · **Closes checklist #24 (copy / content guidelines & microcopy).**
> **Ownership boundary:** this doc governs every UI string **except** error copy — `ERROR-HANDLING.md` §2 is the single source of truth for `userMessage` text and must be quoted verbatim there, never paraphrased here. Screen **content** stays in `SCREENS-SPEC.md`; this doc decides **how it is worded**.
> Enforcement: `i18n/no-hardcoded` lint rule (LOCALIZATION-SPEC §5.1) + the string inventory in §8 must match `src/i18n/en.json` key names exactly (QA-CHECKLIST **Q8**, docs synced).

---

## 1. VOICE (three rules, in priority order)

1. **Precise beats friendly.** The reader is accountable for these numbers to a board and an auditor. Copy gives the exact figure, scope, period and action; it never softens a fact.
2. **Neutral beats reassuring.** Never imply the data is fine when it is not, and never imply catastrophe when a gate is merely blocking. "Tie-out is out by 1,250.00 — 3 rows flagged" not "Something went wrong!".
3. **Plain beats clever.** No idiom, no metaphor, no joke, no emoji, no exclamation mark anywhere in product UI. An FP&A reader re-reads a clever line once and distrusts it forever.

**Register:** professional second person ("you"), present tense, active voice, American English spelling. Address the person, name the artifact precisely (Company File, Sheet, Scenario, Import Batch, Business Unit — never "your stuff", "the board", "your file").

**Never:** "simply", "just", "easy", "obviously", "great!", "oops", "unfortunately", "we noticed", hedged blame ("you may have entered…"), or any first-person plural apology. If a number is wrong, say what is wrong and where.

---

## 2. MECHANICS (every string)

| Rule | Correct | Wrong |
|---|---|---|
| Sentence case for titles, labels, buttons, menus, tabs, chips | `Tie-out status`, `Run now` | `Tie-Out Status`, `RUN NOW` |
| Exception — proper nouns & locked terms keep their capitalisation | `Industry Pack`, `Business Unit`, `Board Pack`, `Recovery Phrase` | `industry pack` |
| Button = verb (or verb + noun when 2+ actions share a target) | `Commit batch`, `Backup now` | `OK`, `Click here`, `Submit it` |
| One sentence per string; no `\n` inside a key (use two keys) | — | `"Line 1\nLine 2"` |
| Numbers: use the formatter, never inline arithmetic in copy | `{count} rows` rendered via locale rules | string `+ count +` concatenation |
| Money in copy uses Money Value display (tabular, sign style from Settings) | `out by 1,250.00` | `$1.25k`, `1250` |
| Units/abbreviations spelled out on first use per screen | `Fiscal Year`, `Year to Date` | `FY26 YTD` bare |
| Range = en dash, no spaces | `P01–P13` | `P01 - P13` |
| Placeholder syntax `{name}` (ICU, i18next) — typed in the schema | `{attempts} left` | `%d`, `${x}` |
| Time = 24-hour, locale-aware; date per LOCALIZATION-SPEC §3 | `14:02`, `Jan 31, 2027` | `2pm`, `31/01/27` |
| No trailing period on labels/buttons/menu items; full sentence on help text and banners | `Reason required` / `Every total must tie before export.` | `Run now.` |
| Question marks only when the user must decide | `Replace the Baseline?` | `Are you sure you want to continue?` |
| Contractions allowed in prose (help, explainers), never in legal/gate copy | — | — |
| Never use color/emoji as the word; pair the icon with text (B11) | `Unfavorable ▲` | `🔴` alone |
| Never address the user by their own PIN, path, or secret | — | any literal echo of a secret |

---

## 3. SCREEN-SLOT PATTERNS

Copy is generated per slot, never per screen — the slot defines the shape, the spec defines the content.

| Slot | Formula | Example (Acme, FY26) |
|---|---|---|
| PAGEHEAD title | artifact name (locked term) | `Chart of Accounts` |
| PAGEHEAD subtitle | scope only if the screen can show two scopes | `Group · 3 Business Units · P01–P13` |
| Empty (cold) | `No {artifact}` + how to get the first one + primary CTA | `No Accounts — add from the Industry Pack or import a GL Dump.` |
| Empty (wrong state) | name the missing precondition + the route to fix it | `No Actuals yet. Import a GL Dump to compare against Budget.` |
| Loading | present participle, ≤4 words, only when a real progress source exists | `Decrypting Company…` |
| Blocked-by-gate | `{gate} must {pass} before {action}` | `Tie-out must balance before commit.` |
| Success (toast) | `{artifact} {verb-in-past}` + optional link | `Batch committed — 41,203 rows` |
| Undoable note | `Undo (⌘Z) available until you leave the Sheet` | — |
| Destructive lead | `This {consequence}, and it is recorded in the Audit Trail.` | `This removes 2 Sheets, and it is recorded in the Audit Trail.` |

Cold-empty vs wrong-state-empty must be distinguishable from the copy alone: the second always names what is missing and where to go (EmptyState rule, COMPONENT-LIBRARY §EmptyState).

---

## 4. ERROR COPY (delegated)

1. `ERROR-HANDLING.md` §2 `userMessage` is **the** copy; code, mock and i18n carry it verbatim (CHANGELOG KI-013 precedent). Any wording change = edit that table first, then the three mirrors; never copy the table into this file.
2. Rendering rules (banner vs inline vs modal, retry visibility, countdown) = `ERROR-HANDLING.md` §3.
3. What this doc adds: **the three-part shape every new `userMessage` must satisfy** — *what failed* · *the scope/number* · *the fix or route*. `Too many attempts. Try again in {countdown}s.` is the reference model.
4. Never expose the raw `message`, a Rust path, a stack, SQL, or a field id the user cannot see. Field paths are OK only when the field is visible (`mapping.columns[3].target`).
5. Never enumerate what the user did wrong morally ("incorrect value entered by you"); state the rule that was not met.

---

## 5. LABELS & LEXICON (locked)

**Navigation:** `Dashboard · Data · Model · Plan · Analyze · Reports · Governance · Settings`.

**Scenario states:** `Draft · Review · Approved · Locked`. Never "Open/Closed/Published/Final".

**Verb table (use these, not synonyms):**

| Do | Say | Do not say |
|---|---|---|
| Add a row/entity | `Add line`, `Add account`, `New Scenario` | `Create new…`, `Insert` |
| Bring data in | `Import`, `Parse`, `Map`, `Validate` | `Load`, `Ingest data` |
| Finalise a batch | `Commit batch` | `Submit`, `Finish`, `Save` |
| Recompute | `Recalculate` (short label: `Recalc`) | `Refresh`, `Update numbers` |
| Freeze a Scenario | `Lock` | `Freeze`, `Archive` (archive = Company-level only) |
| Mark the official plan | `Set as Baseline` | `Make official`, `Publish` |
| Produce a file | `Export to Excel`, `Export to PDF` | `Download`, `Print`, `Generate report` |
| Copy for sandbox | `Clone as Sandbox` | `Duplicate`, `Save as copy` |
| Go back to a prior batch | `Roll back` | `Undo`, `Revert` |
| Remove with confirm | `Delete` | `Destroy`, `Clear`, `Remove` (remove = detach a relation only) |
| Skip a gate with reason | `Waive` | `Ignore`, `Bypass`, `Override` |
| Send to the next stage | `Submit` (cycles only) | `Send`, `Push` |

**Nouns:** `Business Unit (BU)` — never "entity"/"division"/"segment" for a BU (segment means the report only); `Sheet` — never "tab"/"worksheet" in copy; `Model` — never "workbook"/"file"; `Company File` — never "database"/"project"; `Industry Pack` — never "template pack"; `Actuals` vs `Plan` vs `Budget` vs `Forecast` are distinct locked terms — do not interchange them; `Variance`, `Tie-out`, `Audit Trail`, `Board Pack`, `Recovery Phrase`.

**Favorable/unfavorable:** always the words `Favorable` / `Unfavorable` (or `F`/`U` inside a dense grid) — never "good/bad", "up/down" as meaning.

**Numbers meaning:** `n/a` for missing (never `0`, never `—` alone, never blank). `0.00` is a real zero and must read as such.

---

## 6. DIALOG & NOTIFICATION COPY

| Surface | Pattern | Reference string |
|---|---|---|
| Modal title | the decision, not the object | `Replace the Baseline?` (not `Baseline dialog`) |
| Modal body | consequence → what is affected → recoverability | `The current Baseline becomes read-only history. This is recorded in the Audit Trail.` |
| Danger confirm | type-the-name when the object is destructive | `Type the Scenario name to confirm.` |
| Cancel label | `Cancel` always (never `Close`/`No`/`Discard` on a confirm) | — |
| Primary in danger dialog | the verb, not "Confirm" | `Delete Scenario`, `Roll back batch` |
| Toast | ≤6 words + optional link; auto-dismiss 4.5s except errors | `Model saved` · `4 findings — view` |
| Toast (error) | no auto-dismiss; carries the code text | `Commit failed — IMPORT_TIE_OUT_FAILED` |
| Alert Center item | `{what} {measure} {threshold} in {period}` | `Cash floor below 1,000,000.00 in P09` |
| OS notification | only what + where; never a value or a name | `1 alert needs review — open Alerts Center` |
| Health/audit waiver | reason is a full sentence, prompt says why | `Reason (required, 10–200 characters) — recorded with your name in the Audit Trail.` |
| Update available (D-009) | what changed for the user, then the choice | `Version 0.2.0 fixes statement export. Install now or later.` |
| License grace | state the date and the consequence, no scare language | `License expires 2027-01-31. After that the Company becomes read-only.` |

Silence rules: never toast a read; never toast per-row during a batch (one summary only); never open a modal on load unless a gate blocks the route (locking, license grace, chain break).

---

## 7. HELP, EXPLAINERS & EMPTY-STATE TONE

1. Explainer shape (D-008 / S-076) is fixed: **Definition → Formula → Worked example → Source**. Definition ≤ 2 sentences; formula in monospace; the example uses real fixture numbers from `TEST-FIXTURES-SPEC.md`, never invented ones.
2. Every KPI explainer names the direction that is favorable ("Higher is better" / "Lower is better") — a board reader must not guess.
3. `Onboarding` copy is task-shaped, not tour-shaped: "Import a GL Dump", not "Welcome! Let's explore the app". No marketing sentences, no feature list, no upsell (no in-app commercial prompts exist in v1.0.0 — PRD).
4. First-run wizard step help = one line: `{step}: {what you decide here}`. E.g. `Calendar: how your fiscal year is cut into periods.`
5. Never reference a capability that is not shipped (no "coming soon", no "this will be possible in v1.1"). Missing capability = disabled control + explicit reason (WIREFRAMES-CORE R7/§6).
6. Legal/consent lines stay literal and short: `No data leaves this machine.` Only if COMPLIANCE-DATA-SOVEREIGNTY.md says so.
7. Email/notification templates **do not exist** in this product (no server, B18-9). If a future version needs email, its copy lives in a new indexed doc, not here.

---

## 8. STRING INVENTORY RULES (i18n)

1. Key = `screenId.domain.element`, lowercase, dot-separated, stable forever: `s030.importHub.tab.glDump`, `s032.tieOut.footstrip.difference`, `common.action.recalculate`.
2. Reuse `common.*` for verbs/labels before minting a new key; a new key requires a PR line in the §8b registry table (below) — this file is the registry.
3. Never reuse one key for two meanings; fork the key.
4. Plurals use ICU `plural` with `{count}` — and `{count}` is a number, not a pre-formatted string.
5. Keys are added with English values; translations arrive with V-011 (v1.1) — the key set must not change then (frozen contract).
6. Length budget for testability and `bp-sm`: button ≤ 22 chars, nav ≤ 14, toast ≤ 45, modal title ≤ 38, page title ≤ 24. A string that cannot fit ships with a shorter locked synonym from §5, not a truncated label.
7. No string is built by concatenation (`"No " + noun`) — word order changes with language.

### 8b. Seed registry (the strings every screen must have before UI code lands)

| Key | en value | Used by |
|---|---|---|
| `common.action.import` | `Import` | S-030, S-010 |
| `common.action.recalculate` | `Recalculate` | S-040, S-041 |
| `common.action.export.excel` | `Export to Excel` | S-060, S-064, D-003 |
| `common.action.export.pdf` | `Export to PDF` | S-060, S-064, D-003 |
| `common.action.cancel` | `Cancel` | all dialogs |
| `common.state.na` | `n/a` | MoneyCell, KPI cards |
| `common.gate.tieOut.blocked` | `Tie-out must balance before export.` | S-060, S-064 |
| `common.gate.health.blocked` | `Health Check found blocking issues. Resolve them before export.` | S-064, S-071 |
| `common.readonly.license` | `License expired. The Company is read-only. Activate to continue.` | S-073 (mirror of ERROR-HANDLING) |
| `s001.unlock.primary` | `Unlock` | S-001 |
| `s001.unlock.recovery` | `Forgot? Use Recovery Phrase` | S-001 |
| `s002.wizard.stepHint.calendar` | `Calendar: how your fiscal year is cut into periods.` | S-002 |
| `s010.dashboard.empty.planOnly` | `No Actuals — projected range from drivers.` | S-010, KpiCard |
| `s020.company.empty.cta` | `No Companies yet — create your first.` | S-020 |
| `s030.hub.empty.noCompany` | `Select or create a Company to start an import.` | S-030 |
| `s030.hub.note.notCommitted` | `Nothing has been committed yet.` | S-030 |
| `s031.map.hardBlock` | `{count} blocking findings must be fixed before continuing.` | S-031 |
| `s032.commit.difference` | `Out by {amount}.` | S-032 |
| `s032.commit.exclusionReason` | `Reason for excluding this row (required, logged).` | S-032 |
| `s041.grid.empty` | `No lines — add from the Industry Pack or add a line.` | S-041 |
| `s041.grid.lockedCell` | `This Scenario is locked. Create a Version to change it.` | S-041 |
| `s044.assumption.help` | `One value, referenced everywhere. Changing it recalculates every Sheet.` | S-044 |
| `s050.scenario.confirmLock` | `Locking creates an immutable Version.` | S-050 |
| `s050.scenario.baselineReason` | `Reason for replacing the Baseline (required, recorded).` | S-050 |
| `s054.variance.notAttributable` | `Not attributable — no driver feed for this line.` | S-054 |
| `s055.fva.needVersions` | `Need at least 3 Forecast Versions to score a line.` | S-055 |
| `s060.statement.zero` | `No data for this period.` | S-060 |
| `s070.audit.readonly` | `Audit chain broken. The Company is read-only until restored.` | S-070 |
| `s071.health.waiveHelp` | `A waiver never fixes the number. It records that a human accepted it.` | S-071 |
| `s072.security.recoveryWarning` | `Store these words offline. Without them, a lost PIN means the Company cannot be recovered.` | S-072, D-007 |
| `s073.license.grace` | `License expires {date}. After that the Company becomes read-only.` | S-073 |
| `s074.backup.preRestoreNote` | `A pre-restore snapshot is taken before anything is overwritten.` | S-074 |
| `s075.settings.unavailable.diagnostics` | `Diagnostics export needs the desktop build.` | S-075 |

---

## 9. REVIEW GATE (copy-specific, added to CODING-STANDARDS §7)

- [ ] Every new/changed string is in `src/i18n/en.json` under a §8b key (no hardcoded literal in JSX).
- [ ] Terminology matches GLOSSARY.md; no banned synonym (CI banned-term scan is the backstop).
- [ ] Sentence case, locked nav/state verbs, no exclamation mark, no emoji, no marketing word.
- [ ] Empty/loading/blocked patterns from §3 present for each of the 5 states.
- [ ] Error strings verbatim from `ERROR-HANDLING.md`; no new error wording invented in a component.
- [ ] Length budgets (§8.6) hold at 200% zoom and `bp-sm`.
- [ ] No capability promise for anything outside PRD v1.0.0.

*Referenced by: DOCS-INDEX.md, QA-CHECKLIST.md, COMPONENT-LIBRARY.md, CLAUDE.md.*
