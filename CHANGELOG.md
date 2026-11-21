# Changelog

All notable changes to Assay are documented in this file.

## [0.2.0] - 2026-11-21

### Added
- Offline single-document check command (`assay check <file> [--year <year>] [--json] [--fail-on watch|flag]`) and library entry points (`checkText`, `checkDocument`, `exceeds` in `src/check.ts`), supporting HTML, PDF, HWP, HWPX, DOCX, XLSX, TXT, MD, and TSV inputs with no network access.
- Machine-readable JSON output (`--json`) for `analyze`, `check`, and `reconcile`.
- First-digit Benford screening check (`quality.digits` in `src/checks/digits.ts` and `amountTokens` in `src/statements/document.ts`) using distinct comma-grouped amounts, Nigrini's first-digit MAD conformity bands (`0.006`, `0.012`, `0.015`), expected sampling MAD, closed-form 8-df chi-square reference p-value, and most-repeated amount reporting; also included in the static browser workbench (`site/`).
- Structured restatement classification (`compareRestatement` and `MEASUREMENT_LINES` in `src/checks/reconcile.ts`) separating IAS 8 measurement changes (`totalAssets`, `totalLiabilities`, `totalEquity`, `retainedEarnings`, `netIncome`, rated `watch`) from IAS 1.41 / IFRS 5 presentation reclassifications (`info`), with percentage deltas and largest change as a share of total assets.
- Differential, fuzz-style, hostile-input, and CLI integration test suites (`test/hardening.test.ts`, `test/digits-and-cli.test.ts`, `test/fixtures/samsung-2025-statements.html`), bringing automated coverage to 111 tests.

### Changed
- Replaced backtracking regexes in HTML flattening (`htmlToLines`, `stripTags`) with linear-time scanners, bounded statute citation matching (`src/checks/external.ts`), capped label length and subtotal pair search (`MAX_PAIR_ROWS`), and rejected unsafe integer magnitudes (`Number.isSafeInteger`) during statement extraction and OpenDART parsing.
- Hardened financial ratio checks (`beneish`, `altman`, `piotroski`, `quality.accruals`, `solvency.current`, `quality.ppe-roll` in `src/checks/financial.ts`) so zero or non-positive denominators report `unavailable` instead of `NaN`, `Infinity`, or misleading scores.
- Hardened OpenDART ZIP extraction (`readZipEntry`) with full central-directory/local-header bounds checks, encryption and compression-method rejection, and inflate error wrapping; tightened `parseEnvelope` (`src/sources/mcp.ts`) and `factsToPeriod` (`src/sources/sec.ts`) against malformed upstream payloads.

## [0.1.0] - 2026-11-07

### Added
- Initial release with KRX KIND, OpenDART, US SEC 20-F, and public-record cross-checking across 10 layers, Markdown/JSON/HTML/HWPX reporting, static browser demo, and 39-company-year validation suite (`validation-freeze-4`).
