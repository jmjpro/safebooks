Status: ready-for-agent

# Document Data Extraction Pipeline

## Problem Statement

Customers drop Order Form and Purchase Order documents into a folder. Right now nothing reads them: the field values needed downstream — dates, amounts, payment terms, billing address, signature presence, line items, and the free-text Special Terms (Burst, Technical Account Manager) — exist only inside PDFs, per customer, in whatever phrasing that customer's document template uses. There's no automated way to turn a folder of these PDFs into structured, queryable records, and no way to tell, after the fact, which documents extracted cleanly versus which ones need a human to look at them.

## Solution

A pipeline processes documents from an input folder: it classifies each one by content (never filename) as an Order Form or a Purchase Order, extracts its Structured Fields and Natural Language Fields via an LLM, and persists the result — Order Forms as Sales Order (SO) records, Purchase Orders as Purchase Order (PO) records, each with their Item rows — to Postgres, per [ADR-0001](../../docs/adr/0001-separate-so-po-tables.md). A document that extracts and validates cleanly is saved with a "processed" status; a document where at least one field fails after retries is still saved, with whatever fields succeeded, flagged with the `needs_review` status rather than dropped. No per-customer configuration is stored ([ADR-0003](../../docs/adr/0003-no-persisted-customer-config.md)) — adaptability across customer phrasing comes from the LLM's generalization, validated by an eval run against the real sample documents.

## User Stories

1. As a pipeline operator, I want documents sitting in the input folder to be processed in a single run, so that I don't have to manually trigger extraction per file.
2. As a pipeline operator, I want each document classified as an Order Form or a Purchase Order based on its content, so that a misleading or generic filename doesn't cause misrouting.
3. As a pipeline operator, I want an Order Form document stored as an SO record, so that internal records use the correct type per the existing schema split.
4. As a pipeline operator, I want a Purchase Order document stored as a PO record, so that PO data stays separate from SO data.
5. As a pipeline operator, I want the Start Date extracted in mm-dd-yyyy format, so that dates are consistently structured for downstream reporting.
6. As a pipeline operator, I want the End Date extracted in mm-dd-yyyy format, so that contract terms can be reliably compared across documents.
7. As a pipeline operator, I want the Amount extracted as a numeric value, so that totals can be aggregated and reported on.
8. As a pipeline operator, I want the Payment Terms extracted in "Net xx" format, so that payment expectations are captured consistently.
9. As a pipeline operator, I want the Billing Address extracted as free text, so that invoicing/mailing information is available downstream.
10. As a pipeline operator, I want to know whether a Customer Signature is present (True/False), so that unsigned documents can be flagged for follow-up.
11. As a pipeline operator, I want the full list of Items (product name, quantity, price, total amount) extracted per document, so that line-item detail is available, not just document totals.
12. As a pipeline operator, I want the Burst Special Term extracted as a document-level field, so that overage allowances are captured even though every sample document describes them in prose, not per item (per ADR-0002).
13. As a pipeline operator, I want the Technical Account Manager Special Term extracted as a Natural Language Field, so that account ownership per contract is recorded.
14. As a pipeline operator, I want a document where every field extracts and validates successfully to be saved with a "processed" status, so that clean extractions are distinguishable from ones needing attention.
15. As a pipeline operator, I want a document where at least one field fails to extract or validate after retries to be saved with the `needs_review` status, retaining whatever fields did succeed, so that partial data isn't lost while the gap is flagged for a human.
16. As a pipeline operator, I want a failed field extraction retried automatically before it's marked as failed, so that a transient LLM error doesn't unnecessarily trigger `needs_review`.
17. As a pipeline developer, I want the extraction step isolated behind a swappable interface, so that pipeline mechanics — retries, status assignment, SO/PO table routing — can be tested deterministically without depending on live LLM output.
18. As a pipeline developer, I want an end-to-end eval that runs the real pipeline against the real sample documents and a real database, so that the ≥95% field-level Accuracy KPI is measured against real behavior, not mocks.
19. As a hiring reviewer, I want the pipeline to correctly handle both document types (Order Form and Purchase Order), so that the Coverage KPI is demonstrably met.
20. As a hiring reviewer, I want the pipeline to correctly handle at least 2 customer-specific phrasing variations per document type, so that the Adaptability KPI is demonstrably met without a per-customer config system.
21. As a hiring reviewer, I want a README with setup and usage instructions, so that I can run the pipeline myself against the sample documents.
22. As a pipeline operator, I want extracted Order Form items stored in the so_items table linked to their parent SO record, so that item-level detail can be queried per Sales Order.
23. As a pipeline operator, I want extracted Purchase Order items stored in the po_items table linked to their parent PO record, so that item-level detail can be queried per Purchase Order.
24. As a pipeline operator, I want the source document's filename retained on the saved record, so that a `needs_review` record can be traced back to the original PDF for manual follow-up.
25. As a pipeline developer, I want document classification and field extraction to use the domain glossary's terminology in code and tests, so that the implementation stays aligned with CONTEXT.md and future readers aren't confused by synonyms like "Buyer" or "Client" for Customer.
26. As a pipeline operator, I want the Customer name captured from the document's billing fields (Bill To / Buyer), so that each record is attributable to the counterparty it was billed to.
27. As a pipeline developer, I want a document that can't be classified as either known Document Type to still be recorded rather than silently dropped, so that unexpected input is visible instead of disappearing.

## Implementation Decisions

- **Entry point**: a CLI command processes every document currently present in the input folder in a single run (batch, not a long-running watch daemon — see Out of Scope). Re-running it is how newly-arrived documents get picked up.
- **Classification + extraction are one LLM call per document**: the same call that extracts fields also returns the classified Document Type, rather than a separate classification pass. This keeps the number of LLM round-trips (and seams) minimal.
- **Extraction is behind a `FieldExtractor` port**: an interface taking a document's content and returning `{ documentType, fields, items, fieldErrors }`. One implementation calls the Anthropic API (the `ANTHROPIC_API_KEY` already provisioned in `.env`); a second, stub implementation returns canned responses for pipeline-mechanics tests. This is the swappable seam referenced in the User Stories and Testing Decisions.
- **Retry policy**: a field that fails to extract or fails validation (e.g., a date that doesn't parse to mm-dd-yyyy, an amount that isn't numeric) is retried up to 2 additional times (3 attempts total) before being treated as failed for that field. Retries are per-field-failure-driven, not a whole-document re-run, though the initial implementation may re-issue the whole extraction call and keep only the fields that newly succeed.
- **Status assignment**: if every required field extracts and validates, the record is saved with a "processed" status. If at least one field fails after retries, the record is still saved — with whatever fields succeeded and the failed fields left null/absent — under the `needs_review` status.
- **Persistence routing**: classified Document Type determines the target tables — Order Form → `so`/`so_items`, Purchase Order → `po`/`po_items`, per ADR-0001. An unclassifiable document is recorded (not dropped) with `needs_review` status and no type-specific table row — the exact holding location is an implementation detail to resolve during build, but it must not be silently discarded.
- **Burst**: stored as a single field on `so`/`po` (document-level), not on the items tables, per ADR-0002.
- **No per-customer config table**: `Customer` is extracted per-document as data (from Bill To / Buyer), not looked up against a stored customer profile. No new schema for customer-specific extraction hints, per ADR-0003.
- **Schema additions beyond the two ADR'd table pairs**: `so`/`po` need a `status` column (`processed` / `needs_review`), a source-document filename/reference, and a processed-at timestamp — none of these are yet captured in an ADR and should be added as part of this build.
- **Amount and item price/total** are stored as numeric types, not formatted strings.
- **Customer Signature** is stored as a boolean.

## Testing Decisions

- **Primary seam — end-to-end eval**: runs the real pipeline entry point against the 4 real sample documents in `sample-input/` (2 Order Form customers: ACME, CloudShield; 2 Purchase Order customers: BrightOps Analytics, NovaFleet Technologies), using the real Anthropic API and a real (test) Postgres database — no LLM mocking here. Assertions compare the resulting `so`/`po` and `so_items`/`po_items` rows against hand-verified expected values per sample document. This single suite is what demonstrates all three KPIs: Coverage (both document types present), Adaptability (2 customer variants per type), and Accuracy (≥95% field-level correctness across the sample set).
- **Secondary seam — pipeline mechanics**: a lower-level suite exercises the pipeline with the `FieldExtractor` port replaced by a stub returning canned responses (success, partial failure, retry-then-succeed, retry-exhausted). This suite still writes to a real (test) Postgres database — only the LLM call is faked — and covers: `needs_review` vs "processed" status assignment, retry-then-recover, correct SO vs PO table routing, item rows correctly linked to their parent record, and the unclassifiable-document path.
- **No Postgres mocking anywhere**: consistent with testing external behavior rather than implementation details, both suites hit a real test database.
- **Prior art**: none — this is the first feature built in the repo. `package.json`'s `test` script is currently a stub (`exit 1`); a test runner needs to be chosen as part of implementation. No PDF-parsing library, Postgres client, or Anthropic SDK is installed yet either.

## Out of Scope

- Continuous/long-running folder watching (e.g., an fs-watch daemon). The pipeline processes what's currently in the folder per invocation; true watch-mode automation is not part of this spec.
- Persisted per-customer field configuration or any admin interface for it (ADR-0003).
- Any UI or dashboard for reviewing `needs_review` documents — this spec covers flagging and persistence only, not a review workflow.
- Support for document types beyond Order Form and Purchase Order.
- Internationalization of dates, currency, or address formats beyond the mm-dd-yyyy / "Net xx" formats the assignment specifies.
- Authentication, multi-tenancy, or any customer-management features beyond storing the extracted Customer name as data.
- Hosting/deployment infrastructure — the assignment's deliverable is a GitHub repo with code and a README covering setup and usage, not a deployed service.

## Further Notes

- `.env` already provisions `ANTHROPIC_API_KEY` — the LLM implementation of `FieldExtractor` should use the Anthropic API.
- The choice of test runner, PDF-parsing library, and Postgres client/driver is left to implementation; none are installed yet.
- Domain vocabulary — Document, Document Type, SO, PO, Structured Field, Natural Language Field, Special Terms, Burst, Technical Account Manager (TAM), Item, `needs_review` status — is defined in `CONTEXT.md` and should be used as-is in code, schema, and tests.
- Original assignment brief: `ASSIGNMENT.md`. Sample documents: `sample-input/`.
