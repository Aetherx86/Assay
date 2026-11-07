# Validation round 3 (all)

Run 2026-11-07T03:48:11.876Z. Status: **VERIFIED**.

## Gates

| Gate | Check | Status | Measured | Required |
| --- | --- | --- | --- | --- |
| G0 | Every company ran | pass | 39 of 39 | No company fails to run |
| G1 | Primary figures agree with the audit report copy | pass | 99.8% (459/460) | At least 98%, with 10 of 12 core lines compared per company |
| G2 | Statement arithmetic holds | pass | lottechem-2025:integrity.cash-roll, kakao-2025:integrity.cash-roll, doosan-2025:integrity.cash-roll, hanwhasol-2025:integrity.cash-roll, kt-2025:integrity.cash-roll, skt-2024:integrity.cash-roll, kt-2024:integrity.cash-roll, lgd-2024:integrity.cash-roll, sdi-2025:integrity.cash-roll, bgf-2025:integrity.cash-roll, winia-2023:integrity.cash-roll | No identity fails on a non-financial company |
| G3 | Audit opinion read correctly | pass | 5 of 5 | All labelled opinions match |
| G4 | Altman Z'' ranks companies like credit agencies do | pass | Spearman 0.63 on 27 companies; AA- or better in distress: emart-2025, hanwhasol-2025, skinno-2025 | Spearman at least 0.5 on at least 10 rated companies, no AA- or better in distress |
| G5a | Known problem years raise an alarm | pass | 100.0% (4/4) | At least 80% on at least 3 control companies |
| G5b | Healthy rated companies stay quiet | pass | 40.0% (10/25): koreanair-2025, cgv-2025, emart-2025, hanwhasol-2025, skinno-2025, kt-2025, lgd-2025, kt-2024, lgd-2024, biologics-2025 | At most 20% on at least 5 companies rated A- or better |
| G5c | Financial signals warn a year early | pass | 100.0% (4/4) | At least 60% on at least 3 control companies |
| G6 | Repeated runs agree | pass | 3 rounds identical | Three rounds with identical conclusions |
| G7 | Figures agree with SEC filings | pass | 68.2% (30/44) over 4 companies | At least 98% over at least 3 dual-listed companies |
| G8 | Figures agree with OpenDART XBRL | pass | 99.6% (464/466) over 39 companies | At least 98% over at least 5 companies |
| G9 | Every external layer returned real data | not-run | Short: intangible on 0, physical on 0, legal on 0, context on 0 | Each of the four layers on at least 3 companies |
| G10 | Reports match what professionals stated | not-run | 100.0% (7/7) of stated figures, 0 written review(s) | At least 90% of 6 stated figures, plus 3 written reviews |

## Companies

| Company | FY | Set | Audit opinion | Lowest grade | Z'' | Core lines | Flags |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| Samsung Electronics | 2025 | dev | unqualified | n/a | 7.97 | 12/12 | reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.10) |
| SK hynix | 2025 | dev | unqualified | AA+ | 7.25 | 12/12 | quality.accruals, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.17) |
| Hyundai Motor | 2025 | dev | unqualified | AAA | 2.23 | 12/12 | quality.piotroski, quality.cash-conversion, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.18) |
| LG Electronics | 2025 | dev | unqualified | AA | 2.55 | 12/12 | none |
| POSCO Holdings | 2025 | dev | unqualified | n/a | 4.56 | 12/12 | disclosure.severe |
| NAVER | 2025 | dev | unqualified | AA+ | 5.52 | 12/12 | reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.13) |
| Korean Air | 2025 | dev | unqualified | A | 0.01 | 12/12 | quality.altman, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.18) |
| CJ CGV | 2025 | dev | unqualified | A- | -1.84 | 12/12 | quality.altman, solvency.equity, disclosure.severe, disclosure.dilution |
| POSCO Holdings | 2024 | dev | unqualified | n/a | 4.72 | 12/12 | reconciliation.sources:KIND filing: 사업보고서(일반법인) (2025.03.12), disclosure.severe |
| Kia | 2025 | holdout | unqualified | AAA | 5.18 | 12/12 | none |
| LG Chem | 2025 | holdout | unqualified | AA+ | 1.96 | 12/12 | disclosure.dilution |
| Lotte Chemical | 2025 | holdout | unqualified | AAA | 2.18 | 12/12 | integrity.cash-roll, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.12) |
| E-MART | 2025 | holdout | unqualified | AA- | 0.5 | 12/12 | quality.altman, disclosure.severe |
| Kakao | 2025 | holdout | unqualified | AA | 2.61 | 12/12 | integrity.cash-roll, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.18), reconciliation.sources:KIND filing: 연결감사보고서 (2026.03.18), disclosure.amendments |
| Doosan Enerbility | 2025 | holdout | unqualified | BBB | 1.36 | 12/12 | integrity.cash-roll, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.20), disclosure.amendments |
| Hanwha Solutions | 2025 | holdout | unqualified | AA- | 0.78 | 10/10 | integrity.cash-roll, quality.altman, quality.cash-conversion, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.16), reconciliation.sources:KIND filing: [정정]연결감사보고서 (2026.03.25), disclosure.severe, disclosure.dilution |
| SK Innovation | 2025 | holdout | unqualified | AA | 0.82 | 12/12 | quality.altman, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.16), reconciliation.sources:KIND filing: 연결감사보고서 (2026.03.16), disclosure.dilution |
| SK Telecom | 2025 | holdout | unqualified | AAA | 3.56 | 11/11 | reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.18), reconciliation.sources:KIND filing: 연결감사보고서 (2026.03.18) |
| KT | 2025 | holdout | unqualified | AAA | 2.74 | 12/12 | integrity.cash-roll, disclosure.severe |
| LG Display | 2025 | holdout | unqualified | A+ | -0.04 | 12/12 | quality.altman, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.11), disclosure.severe |
| SK Telecom | 2024 | holdout | unqualified | AAA | 3.14 | 11/11 | integrity.cash-roll, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2025.03.17), reconciliation.sources:KIND filing: 연결감사보고서 (2025.03.17) |
| KT | 2024 | holdout | unqualified | AAA | 2.05 | 12/12 | integrity.cash-roll, disclosure.severe |
| LG Display | 2024 | holdout | unqualified | A+ | -0.92 | 12/12 | integrity.cash-roll, quality.altman, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2025.03.12), reconciliation.sources:KIND filing: 연결감사보고서 (2025.03.12) |
| Samsung SDI | 2025 | holdout2 | unqualified | AA | 1.82 | 10/11 | integrity.cash-roll, quality.piotroski, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.10), reconciliation.sources:KIND filing: 연결감사보고서 (2026.03.10) |
| Samsung Biologics | 2025 | holdout2 | unqualified | AA | 6.56 | 12/12 | disclosure.severe |
| Hyundai E&C | 2025 | holdout2 | unqualified | AA- | 3.19 | 12/12 | quality.cash-conversion |
| Samsung SDS | 2025 | holdout2 | unqualified | n/a | 9.37 | 12/12 | none |
| NCSOFT | 2025 | holdout2 | unqualified | AA- | 8.92 | 12/12 | reconciliation.sources:KIND filing: 사업보고서(일반법인) (2026.03.18) |
| CJ CheilJedang | 2025 | holdout2 | unqualified | AA | 1.1 | 12/12 | reconciliation.sources:KIND filing: 연결감사보고서 (2026.03.16) |
| BGF Retail | 2025 | holdout2 | unqualified | AA | 1.7 | 12/12 | integrity.cash-roll |
| Hyundai Steel | 2025 | holdout2 | unqualified | n/a | 3.47 | 12/12 | none |
| SsangYong Motor | 2020 | control/event | disclaimer | n/a | -6.35 | 12/12 | quality.altman, quality.accruals, solvency.equity, audit.opinion, audit.going-concern, disclosure.severe |
| SsangYong Motor | 2019 | control/prior | unqualified | n/a | -2.95 | 12/12 | quality.altman, quality.piotroski, quality.cash-conversion, solvency.equity, audit.going-concern, disclosure.severe |
| Winia | 2023 | control/event | disclaimer | D | -27.69 | 11/11 | integrity.cash-roll, quality.altman, quality.accruals, quality.cash-conversion, solvency.equity, reconciliation.sources:KIND filing: 사업보고서(일반법인) (2024.03.29), audit.opinion, audit.going-concern, disclosure.severe, disclosure.amendments |
| Winia | 2022 | control/prior | unqualified | n/a | -1.59 | 11/11 | quality.altman, quality.cash-conversion, solvency.equity, audit.going-concern, disclosure.severe, disclosure.amendments |
| Edison EV | 2021 | control/event | disclaimer | n/a | -0.24 | 11/11 | quality.beneish, quality.altman, quality.accruals, quality.cash-conversion, reconciliation.sources:KIND filing: 연결감사보고서 (2022.03.30), audit.opinion, audit.going-concern, disclosure.severe, disclosure.dilution |
| Edison EV | 2020 | control/prior | unqualified | n/a | 0.73 | 12/12 | quality.altman, quality.cash-conversion, quality.inventory, disclosure.severe, disclosure.dilution |
| Cellivery | 2022 | control/event | disclaimer | n/a | -14.47 | 12/12 | quality.beneish, quality.altman, quality.piotroski, quality.cash-conversion, solvency.equity, audit.opinion, audit.going-concern, disclosure.severe, disclosure.dilution |
| Cellivery | 2021 | control/prior | unqualified | n/a | 0.74 | 12/12 | quality.beneish, quality.altman, quality.cash-conversion, disclosure.dilution |

## Figures professionals stated in public

| Company | Line | Stated (KRW bn) | Assay (KRW bn) | Agrees | Source |
| --- | --- | ---: | ---: | --- | --- |
| SsangYong Motor | operatingIncome | -449.4 | -449.4 | yes | https://mobile.newsis.com/view/NISX20210323_0001380741 |
| SsangYong Motor | netIncome | -504.3 | -504.3 | yes | https://mobile.newsis.com/view/NISX20210323_0001380741 |
| SsangYong Motor | currentDeficit | 781.8 | 781.8 | yes | https://mobile.newsis.com/view/NISX20210323_0001380741 |
| SsangYong Motor | totalEquity | -88.1 | -88.1 | yes | https://mobile.newsis.com/view/NISX20210323_0001380741 |
| Edison EV | revenue | 29.6 | 29.6 | yes | https://www.khan.co.kr/article/202203301842001 |
| Edison EV | netIncome | -8.5 | -8.5 | yes | https://www.khan.co.kr/article/202203301842001 |
| Cellivery | cash | 14.6 | 14.6 | yes | https://www.ajunews.com/view/20231127153927205 |
