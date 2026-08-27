# 02: Purchase Order → PO happy path

**What to build:** Extend the pipeline built in 01 to correctly classify and route Purchase Order documents to the `po`/`po_items` tables instead of `so`/`so_items`.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Running the CLI against a folder containing a single real Purchase Order sample document produces exactly one new row in `po` (not `so`), with `status = "processed"`.
- [x] The `po` row's Start Date, End Date, Amount, Payment Terms, Billing Address, and Customer Signature match the values in the source document.
- [x] Each item produces a corresponding row in `po_items`, linked to the parent `po` row, with matching product name, quantity, price, and total amount.
- [x] Running the CLI against a folder containing one Order Form and one Purchase Order document produces one row in `so` and one row in `po`, each in the correct table.
- [x] Document type is determined from document content, not filename (e.g., renaming a Purchase Order sample file to something generic still routes it to `po`).

## Comments

`FieldExtractor` already classified `PurchaseOrder` and extracted its fields identically to `OrderForm` (same call, same schema) as of issue 01 — nothing to change there. What issue 02 actually added:

- `po`/`po_items` tables in `schema.sql`, mirroring `so`/`so_items` (same column set, same duplication tradeoff as [ADR-0001](../../../docs/adr/0001-separate-so-po-tables.md)).
- `src/persistence/po-repository.ts` (`savePo`), a direct parallel of `so-repository.ts` rather than a shared abstraction — consistent with ADR-0001's reasoning that duplication cost stays low at exactly two document types.
- `runPipeline` now routes `PurchaseOrder` to `savePo`/`po`, alongside the existing `OrderForm` → `saveSo`/`so` branch. `Unclassified` still throws (surfaces as a pipeline failure rather than a silent drop) — full `needs_review`-without-a-table handling for unclassifiable documents is issue 05.
- New eval suite `tests/eval/purchase-order-happy-path.test.ts`, covering all three PO-related acceptance criteria (single-PO routing, mixed SO+PO folder, filename-independent classification via a renamed sample file). Reused the BrightOps/NovaFleet hand-verified expected values from issue 01.5's model comparison, pulled out into shared fixtures (`tests/eval/fixtures/{brightops,novafleet}-purchase-order.ts`) so `model-comparison.ts` and this suite can't drift apart on what "correct" means for those documents.
- Found and fixed a pre-existing gap surfaced by adding a second eval test file: Node's test runner runs test files concurrently by default, and two files calling `migrate()` concurrently against the same real Postgres race on `CREATE TABLE IF NOT EXISTS`'s implicit sequence creation (`pg_class_relname_nsp_index` duplicate key). Since these eval suites intentionally share mutable state in one real test database (by design, per the spec's "no Postgres mocking" testing decision), fixed by serializing test files (`--test-concurrency=1` in the `test` script) rather than trying to make migration or table state safe under concurrent suites.
- BrightOps' source PDF wraps its billing address across two lines ("42 King George Street" / "London, UK"); the model faithfully returns that line break rather than a comma. Compared billing address with the same whitespace/comma-normalizing check `model-comparison.ts` already used for free-text fields, rather than requiring exact-string formatting a free-text field was never specified to have.
