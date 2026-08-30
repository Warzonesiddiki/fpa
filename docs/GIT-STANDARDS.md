# GIT-STANDARDS.md

> OneFP&A · v1.0.0 · **Commit format, branch naming, PR rules — enforced by husky + GitHub Actions.**

---

## 1. BRANCH NAMING

```
<type>/<ticket-or-feature>-<short-slug>
types: feat | fix | docs | refactor | test | chore | perf | security | release
examples:
  feat/f-012-formula-engine
  fix/import-tieout-rounding
  docs/phase-4-ai-control-layer
  security/keychain-linux-fallback
  release/v1.0.0-rc1
```

Rules: lowercase, hyphens, ≤ 60 chars, never `feature-`-prefixed (redundant), never include `;` or spaces. Branch from `main`; PRs are squash-merged; no long-lived branches (> 2 weeks without a PR note).

## 2. COMMIT MESSAGE FORMAT (Conventional Commits, enforced)

```
<type>(<scope>): <summary>            # ≤ 72 chars, imperative, lowercase
<blank>
<BODY — why, what docs/code affected, references specs (F-xxx / S-xxx / US-xxx)>
<blank>
<FOOTER — BREAKING CHANGE: … | Ref: GH-###>
```

**Allowed types:** `feat` (new PRD feature) · `fix` (defect) · `docs` (specs only) · `refactor` (no behavior change) · `test` · `chore` (tooling/CI) · `perf` · `security` · `release`.

**Scope tokens:** `core` `ui` `ingestion` `connector` `calendar` `engine` `storage` `security` `report` `pack` `ci` `docs` `e2e`.

| Example | Valid? |
|---|---|
| `feat(ingestion): commit GL dump import batch with tie-out gate` | ✅ |
| `feat(ingestion): add GL dump import` | ⚠️ too vague — include F-007 and what changed |
| `fix(calendar): 53rd-week rule for NRF 4-5-4 (F-003)` | ✅ |
| `docs(phase-4): CLAUDE.md, CODING-STANDARDS.md, GIT-STANDARDS.md` | ✅ |
| `updated stuff` | ❌ rejected by hook |
| `refactor(core): money math to rust_decimal (I1)` | ✅ |

**Rules:** one logical change per commit; no `wip`, `fix fix`, empty messages; body required when behavior changes (adds tests note); spec refs required for feature work (`F-007 → PRD`). Squash merging is standard — keep the final squash message meaningful.

## 3. PR RULES (blocking gates)

| Requirement | Detail |
|---|---|
| Title | `<type>(<scope>): <summary>` + link to PRD feature |
| Description template | What/Why (spec refs) · Files · Tests (counts) · Gates output · Risks/waivers |
| Assignee + reviewer | At least 1 explicit reviewer from team; author can't approve own PR |
| Size | ≤ 500 changed lines (docs excluded); larger → split; exceptions need comment |
| CI required | All checks green (see CI-CD.md): tsc · eslint · vitest · cargo test/clippy · e2e · a11y · docs:verify · license:check · schema:equality |
| Sign-off | Reviewer checks CODING-STANDARDS §7 checklist |
| Merge | Squash; delete branch; update `docs-index.json` & CHANGELOG if release-affecting |
| Breaking changes | Must add `BREAKING CHANGE:` footer + update API-SPEC versioned command name |
| Security | `npm audit` + `cargo audit` HIGH=0; secrets scan (no tokens/keys in diff) |
| Migration | Any DB change = migration file + migration test + note in description |

## 4. TAG & RELEASE RULES

`release/vX.Y.Z`:
- `feat:` → minor bump · `fix:` → patch · breaking → major (per semver)
- Tags: `v1.0.0-rc.1`, `v1.0.0` signed (GitHub GPG/Sigstore)
- CHANGELOG.md updated per release (keep-a-changelog format, see CHANGELOG.md)
- Revert policy: revert via new commit `revert(<scope>): <summary>` + reason; never `git reset` on main

## 5. REPOSITORY HYGIENE

- No lockfile churn in feature PRs (only in dependency-update PRs).
- No binaries, `.env`, keychain dumps, sample GL data with real company names (use Demo Company fixtures with synthetic data).
- `docs/` changes require `docs-index.json` update + internal link check (`npm run docs:verify`).
- Generated artifacts (bindings via tauri-specta) commit with source — regeneration is deterministic; CI verifies `git diff --exit-code` after regenerate.

*Referenced by: CI-CD.md, CHANGELOG.md, DEFINITION-OF-DONE.md, CLAUDE.md.*
