# Assay

**[Try the browser demo](https://aetherx86.github.io/assay/) · [Validation protocol](validation/PROTOCOL.md)**

Assay cross-checks what a Korean listed company reports in its financial statements against independent public records: the auditor's report attached on KRX KIND, OpenDART XBRL and filing histories, US SEC 20-F XBRL for dual-listed firms, the national building register, the patent register, the statute database, and regional statistics.

It is a command-line tool and TypeScript library (`@aetherx86/assay`) that outputs structured reports in Markdown, JSON, self-contained HTML, and HWPX (the document format used by Korean public institutions). A static browser version of the statement parser and financial checks runs entirely client-side under a strict Content-Security-Policy (`connect-src 'self'`) so pasted figures never leave the page.

Across 39 company-years (31 distinct Korean listed companies, including 4 control companies whose auditors later issued a disclaimer of opinion), Assay achieves `99.8%` (`459/460`) core line agreement with attached audit reports, `99.6%` (`464/466`) agreement with OpenDART XBRL, `100%` (`4/4`) detection on disclaimer-of-opinion control years and prior-year early warnings, and exact 3-round repeatability.

---

## Contents

1. [What Assay Checks](#1-what-assay-checks)
2. [Data Sources](#2-data-sources)
3. [Installation and Requirements](#3-installation-and-requirements)
4. [Command-Line Usage](#4-command-line-usage)
5. [Library API](#5-library-api)
6. [Statement Normalization and Arithmetic Identities](#6-statement-normalization-and-arithmetic-identities)
7. [Validation Results](#7-validation-results)
8. [Repository Layout](#8-repository-layout)
9. [License](#10-license)

---

## 1. What Assay Checks

Every run evaluates up to ten independent layers. A check that cannot run because a data source, API key, or required line item is missing is marked `unavailable` (`Not run`) and is counted against coverage rather than treated as a pass.

| Layer | Check ID | What It Verifies |
| :--- | :--- | :--- |
| `integrity` | `integrity.assets-split` | `totalAssets = currentAssets + nonCurrentAssets` (including `assetsHeldForSale` when listed outside current assets) within `2 * unit` rounding tolerance |
| `integrity` | `integrity.liabilities-split` | `totalLiabilities = currentLiabilities + nonCurrentLiabilities` (including `liabilitiesHeldForSale` when listed apart) |
| `integrity` | `integrity.balance-sheet` | `totalAssets = totalLiabilities + totalEquity` |
| `integrity` | `integrity.gross-profit` | `grossProfit = revenue - costOfSales` |
| `integrity` | `integrity.cash-roll` | `closingCash = openingCash + cfo + cfi + cff + fxEffect + cashOther` |
| `earnings-quality` | `quality.beneish` | 8-variable Beneish M-Score (`> -1.78` flag, `> -2.22` watch) for earnings manipulation screening |
| `earnings-quality` | `quality.altman` | Altman Z''-Score (`6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4`, `< 1.1` flag, `< 2.6` watch) |
| `earnings-quality` | `quality.piotroski` | 9-test Piotroski F-Score across profitability, leverage/liquidity, and operating efficiency |
| `earnings-quality` | `quality.accruals` | Balance-sheet/cash-flow Sloan accruals ratio `(netIncome - cfo - cfi) / avgAssets` |
| `earnings-quality` | `quality.cash-conversion` | Operating cash flow relative to net income (`cfo / netIncome`) |
| `earnings-quality` | `quality.receivables` | Trade receivables growth minus revenue growth |
| `earnings-quality` | `quality.inventory` | Inventory growth minus revenue growth |
| `earnings-quality` | `quality.ppe-roll` | Opening PP&E plus capital expenditure minus depreciation against closing PP&E |
| `earnings-quality` | `solvency.equity` | Total liabilities to total equity (flags negative equity or `> 400%`) |
| `earnings-quality` | `solvency.current` | Current ratio (`currentAssets / currentLiabilities`) |
| `earnings-quality` | `solvency.intangibles` | Intangible assets as a share of total equity |
| `reconciliation` | `reconciliation.sources:*` | Line-by-line comparison across OpenDART XBRL, the KRX KIND annual report (`사업보고서`), the attached independent auditor's report (`연결감사보고서` / `감사보고서`), and US SEC 20-F XBRL |
| `reconciliation` | `reconciliation.restatement` | Compares the prior-year column of year `T` against the current-year column originally reported in year `T - 1` |
| `audit` | `audit.opinion` | Auditor's opinion (`unqualified`, `qualified`, `adverse`, `disclaimer`) from OpenDART and the audit report letter |
| `audit` | `audit.opinion-match` | Verifies that the OpenDART summary table and the attached audit report state the same opinion |
| `audit` | `audit.going-concern` | Checks for material uncertainty related to going concern (`계속기업 존속불확실성`) |
| `audit` | `audit.kam` | Extracts Key Audit Matters (`핵심감사사항`) from the auditor's report |
| `audit` | `audit.ratings` | Extracts credit ratings (`AAA` through `D`) disclosed in the annual report |
| `disclosure` | `disclosure.severe` | Scans 3-year filing history for embezzlement/breach of duty (`횡령ㆍ배임`), unfaithful disclosure (`불성실공시`), administrative/delisting notices, insolvency, or modified opinions |
| `disclosure` | `disclosure.amendments` | Share of periodic reports (`사업/반기/분기/감사보고서`) followed by amendment filings (`[기재정정]` etc.) |
| `disclosure` | `disclosure.dilution` | Frequency of convertible bond (`전환사채`), warrant (`신주인수권부사채`), exchangeable bond, and rights offerings (`유상증자`) |
| `ownership` | `ownership.insiders` | Net executive/insider share transactions (`임원ㆍ주요주주특정증권등소유상황보고서`) |
| `ownership` | `ownership.major` | 5% blockholder changes (`주식등의대량보유상황보고서`) |
| `intangible` | `intangible.patents` | Patent and utility model registrations in KIPRIS relative to capitalized intangible assets |
| `physical` | `physical.site:*` | Queries the Korean national building register (`건축물대장`) for reported headquarters or plant lot numbers |
| `legal` | `legal.citations` | Extracts Korean statute citations (`...법`, `...에 관한 법률`) from the filing text and verifies them against the National Law Information Center |
| `context` | `context.region` | Retrieves regional industrial and population context for the company's municipality via KOSIS |

---

## 2. Data Sources

Assay works in two modes:

1. **Keyed mode (`DART_API_KEY` set):** Reads structured XBRL financial statements, auditor opinion tables, 3-year disclosure histories, executive holdings, and 5% blockholder filings from OpenDART, and cross-checks them against the HTML/PDF annual report and independent audit report fetched from KRX KIND.
2. **Keyless / document mode (no API key required):** Queries KRX KIND directly (splitting multi-year filing searches into 1-year windows to respect KIND's 3-year query limit), downloads the annual report and attached audit report, and parses the Korean or English financial statements directly from HTML, PDF, DOCX, XLSX, or HWPX.

External public-record checks (`intangible`, `physical`, `legal`, `context`) connect to public Korean government data endpoints (`KIPRIS`, `architecthub` / `국토교통부 건축물대장`, `법제처 국가법령정보센터`, `통계청 KOSIS`) and US SEC EDGAR (`data.sec.gov`) when `--cik` is supplied.

---

## 3. Installation and Requirements

- **Node.js:** `>= 22.18` (uses native TypeScript stripping and the built-in test runner)

```bash
git clone https://github.com/Aetherx86/Assay.git
cd Assay
npm ci
npm run build
```

To enable OpenDART XBRL and ownership checks, create a `.env` file in the repository root (which is git-ignored) or export `DART_API_KEY` in your shell:

```bash
export DART_API_KEY="your_40_character_opendart_key"
```

---

## 4. Command-Line Usage

### Analyze a listed company

```bash
# By 6-digit KRX stock code (works with or without DART_API_KEY)
node dist/cli.js analyze 005930 --year 2025

# Include a dual-listed US SEC CIK and a physical site lot address
node dist/cli.js analyze 005930 --year 2025 --cik 0001046179 --site "경기도 수원시 영통구 매탄동 416"

# Analyze a local filing document (PDF, HTML, HWPX, DOCX, XLSX) offline
node dist/cli.js analyze 005930 --year 2025 --file ./Audit_Report.pdf --offline

# Write output in Markdown, JSON, self-contained HTML, or HWPX
node dist/cli.js analyze 005930 --year 2025 --format md --out samsung-2025.md
node dist/cli.js analyze 005930 --year 2025 --format json --out samsung-2025.json
node dist/cli.js analyze 005930 --year 2025 --format html --out samsung-2025.html
node dist/cli.js analyze 005930 --year 2025 --format hwpx --out samsung-2025.hwpx
```

### Run the validation suite

```bash
# Run round 1 across all 39 company-years in validation/manifest.json
node dist/cli.js validate validation/manifest.json --round 1 --set all

# Skip external non-filing endpoints in subsequent repeatability rounds
node dist/cli.js validate validation/manifest.json --round 2 --set all --no-external
```

### Build the static browser demo

```bash
node scripts/build-site.mjs out/site
```

---

## 5. Library API

```ts
import { analyze } from '@aetherx86/assay/analyze';
import { toMarkdown, toHtml, toJson, toHwpx } from '@aetherx86/assay/report';

const report = await analyze({
  query: '005930',
  fiscalYear: 2025,
  dartKey: process.env.DART_API_KEY,
  skipExternal: false,
});

console.log(toMarkdown(report));
```

Branch `feature/investor-summary` additionally contains `src/summary.ts`, which renders a plain-language investor summary and asset overview from a `Report` without modifying any check, threshold, or validation gate.

---

## 6. Statement Normalization and Arithmetic Identities

Korean filings report figures in varying units (`원`, `천원`, `백만원`, or USD/KRW in 20-F filings) and under varying K-IFRS account labels (`자산총계` vs. `자산 합계`, `매출채권` vs. `유동매출채권`, `영업활동현금흐름` vs. `영업활동으로 인한 현금흐름`).

Assay normalizes every extracted statement into 28 canonical lines in whole KRW (`unit` records the source's rounding step, e.g., `1_000_000` for millions of won):

- **Balance sheet (assets):** `totalAssets`, `currentAssets`, `nonCurrentAssets`, `assetsHeldForSale`, `cash`, `tradeReceivables`, `inventories`, `ppe`, `intangibles`
- **Balance sheet (liabilities and equity):** `totalLiabilities`, `currentLiabilities`, `nonCurrentLiabilities`, `liabilitiesHeldForSale`, `totalEquity`, `retainedEarnings`
- **Income statement:** `revenue`, `costOfSales`, `grossProfit`, `sga`, `operatingIncome`, `netIncome`
- **Cash flows and notes:** `cfo`, `cfi`, `cff`, `capex`, `fxEffect`, `cashOther`, `depreciation`

When K-IFRS 1105 held-for-sale assets (`매각예정비유동자산` / `처분자산집단`) are presented on the balance sheet, some filers include them inside `currentAssets` (e.g., LG Electronics FY2025) while others list them as a separate line between `currentAssets` and `nonCurrentAssets` (e.g., CJ CheilJedang FY2025). Assay checks whether `current + nonCurrent` already equals `total` within `2 * unit` before adding `heldForSale`, avoiding both false-positive gaps and double-counting.

---

## 7. Validation Results

The validation protocol ([`validation/PROTOCOL.md`](validation/PROTOCOL.md)) and manifest ([`validation/manifest.json`](validation/manifest.json)) cover 39 company-years across four sets:

- **`dev` (9 company-years):** Samsung Electronics, SK hynix, Hyundai Motor, LG Electronics, POSCO Holdings (FY2024, FY2025), NAVER, Korean Air, CJ CGV.
- **`holdout` (14 company-years):** Kia, LG Chem, Lotte Chemical, E-MART, Kakao, Doosan Enerbility, Hanwha Solutions, SK Innovation, SK Telecom (FY2024, FY2025), KT (FY2024, FY2025), LG Display (FY2024, FY2025).
- **`holdout2` (8 company-years):** Samsung SDI, Samsung Biologics, Hyundai E&C, Samsung SDS, NCSOFT, CJ CheilJedang, BGF Retail, Hyundai Steel.
- **`control` (8 company-years, 4 companies in the disclaimer year and the prior year with an unqualified opinion):** SsangYong Motor (FY2019, FY2020), Winia (FY2022, FY2023), Edison EV (FY2020, FY2021), Cellivery (FY2021, FY2022).

### Empirical Benchmarks Across 39 Company-Years ([`validation/results/frozen-v4/`](validation/results/frozen-v4/))

| Metric | Measured |
| :--- | :--- |
| **Execution coverage (G0)** | `39 of 39` company-years completed cleanly |
| **Audit report core line agreement (G1)** | `99.8% (459/460)` across 12 core financial lines |
| **OpenDART XBRL agreement (G8)** | `99.6% (464/466)` across 39 company-years |
| **Audit opinion extraction accuracy (G3)** | `5 of 5` labelled opinions (`unqualified`, `disclaimer`) |
| **Altman Z'' rank correlation vs. domestic credit ratings (G4)** | Spearman `0.63` across 27 rated company-years |
| **Disclaimer-of-opinion control detection (G5a)** | `100.0% (4/4)` (`ssangyong-2020`, `winia-2023`, `edisonev-2021`, `cellivery-2022`) |
| **Prior-year early warning signal detection (G5c)** | `100.0% (4/4)` (`ssangyong-2019`, `winia-2022`, `edisonev-2020`, `cellivery-2021`) |
| **Multi-round repeatability (G6)** | `3` consecutive rounds with identical filing-derived fingerprints |
| **Publicly stated figures agreement (G10)** | `100.0% (7/7)` agreement with figures quoted in public reports |

---

## 8. Repository Layout

```text
Assay/
├── src/
│   ├── analyze.ts              # Orchestrates sources and checks into a Report
│   ├── cli.ts                  # CLI entry point (`analyze` and `validate`)
│   ├── report.ts               # Markdown, JSON, HTML, and HWPX formatters
│   ├── types.ts                # Core data structures (Statement, Finding, Report)
│   ├── validate.ts             # Gate evaluator and multi-round runner
│   ├── checks/
│   │   ├── external.ts         # KIPRIS patents, building register, statutes, KOSIS
│   │   ├── filings.ts          # Audit opinions, KAM, severe disclosures, ownership
│   │   ├── financial.ts        # Arithmetic identities, Beneish, Altman Z'', Piotroski
│   │   └── reconcile.ts        # Cross-source and prior-year restatement checks
│   ├── sources/
│   │   ├── dart.ts             # OpenDART XBRL, disclosures, auditors, ownership client
│   │   ├── kind.ts             # KRX KIND scraper and document downloader
│   │   ├── mcp.ts              # Public data gateway client for KIPRIS/MOLEG/KOSIS/buildings
│   │   └── sec.ts              # US SEC EDGAR companyfacts XBRL client
│   └── statements/
│       ├── document.ts         # K-IFRS / IFRS HTML and plain-text statement parser
│       ├── file.ts             # PDF (pdfjs-dist) and office/HWPX (kordoc) loader
│       └── grades.ts           # Credit rating normalization and comparison
├── site/                       # Static browser demo (compiled via scripts/build-site.mjs)
├── test/                       # 80 unit and regression tests (node --test)
└── validation/
    ├── PROTOCOL.md             # Validation gates and evaluation rules
    ├── manifest.json           # 39-company-year validation manifest
    └── results/                # Multi-round validation outputs
```

---

## 9. Limitations

- **Filing format coverage**: Statement extraction targets standard Korean (OpenDART / KIND) and US (SEC EDGAR 10-K / 20-F) annual report layouts; non-standard note tables or scanned PDF filings without structured text are reported as `unavailable` rather than guessed.
- **Screening vs. audit assurance**: A `flag` or `watch` status highlights an accounting identity gap, accrual anomaly, or disclosure pattern that warrants closer human review; it is an analytical screening signal rather than a legal finding.
- **Live external registries**: Optional enrichment layers (building registry, patent registry, regional statistics, and case-law search) depend on external public APIs and require the corresponding API keys at runtime.

## 10. License

MIT License. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
