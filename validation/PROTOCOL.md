# Validation protocol

The gates below are implemented in `src/validate.ts` and evaluated across the 39 company-years in `validation/manifest.json`.

## Question

Does Assay read filed figures accurately across Korean listed companies, and do its conclusions align with independent audit reports, credit ratings, and public records?

## Samples

| Set | Purpose |
| --- | --- |
| dev | Initial calibration across major Korean filers |
| holdout | Out-of-sample evaluation across diverse sectors |
| holdout2 | Blind parser evaluation |
| control | Companies whose auditor issued a disclaimer of opinion, plus the prior fiscal year |

## Gates

| Gate | Check | Target |
| --- | --- | --- |
| G0 | Every company runs | No failures |
| G1 | Primary figures agree with the copy in the audit report | At least 98% of core lines, 10 of 12 compared per company |
| G2 | Statement arithmetic | Identity evaluation across non-financial companies |
| G3 | Audit opinion read from the auditor's letter | All labelled opinions match |
| G4 | Altman Z'' against agency credit grades | Spearman at least 0.5 on at least 10 companies |
| G5a | Known problem years raise an alarm | At least 80% on at least 3 companies |
| G5b | Rated company alarm distribution | Evaluated across companies rated A- or better |
| G5c | Financial signals warn a year early | At least 60% on at least 3 companies |
| G6 | Repeated runs | Three rounds with identical conclusions on filing-derived layers |
| G7 | Figures against XBRL filed with the US SEC | Cross-check across dual-listed 20-F filers |
| G8 | Figures against OpenDART XBRL | At least 98% over at least 5 companies |
| G9 | Patent, building, statute and statistics layers | External public-record verification |
| G10 | Figures professionals stated in public | At least 90% of at least 6 publicly stated figures |
