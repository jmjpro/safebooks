# 06: End-to-end accuracy eval across all 4 sample documents

**What to build:** The end-to-end accuracy eval: run the real pipeline (real Anthropic API, real Postgres) against all 4 real sample documents and assert extracted values against hand-verified expected data, demonstrating the Coverage, Adaptability, and Accuracy KPIs.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] The eval suite runs the CLI against `sample-input/` containing all 4 sample documents (ACME and CloudShield Order Forms; BrightOps and NovaFleet Purchase Orders) using the real Anthropic API and a real test Postgres database, with no `FieldExtractor` stubbing.
- [ ] For each of the 4 sample documents, every extracted structured field, item row, and applicable Special Term is compared against a hand-verified expected value, and the suite reports the field-level match rate.
- [ ] The reported field-level accuracy across the 4 sample documents is ≥95%.
- [ ] The suite demonstrates both document types (Order Form and Purchase Order) and at least 2 customer variants per document type all producing "processed" (not `needs_review`) records.
