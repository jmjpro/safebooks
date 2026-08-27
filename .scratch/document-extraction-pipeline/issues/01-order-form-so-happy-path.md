# 01: Order Form → SO happy path

**What to build:** End-to-end path for a single Order Form document dropped in the input folder: the CLI reads the folder, classifies the document, extracts its Structured Fields (Start Date, End Date, Amount, Payment Terms, Billing Address, Customer Signature) and Items, and persists a Sales Order (SO) record with a "processed" status to Postgres.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Running the CLI against a folder containing a single real Order Form sample document produces exactly one new row in `so`, with `status = "processed"`.
- [ ] The `so` row's Start Date, End Date, Amount, Payment Terms, Billing Address, and Customer Signature match the values in the source document.
- [ ] Each item in the document's items table produces a corresponding row in `so_items`, linked to the parent `so` row, with matching product name, quantity, price, and total amount.
- [ ] The `so` row records the source document's filename and a `processed_at` timestamp.
- [ ] Field extraction goes through a `FieldExtractor` interface with an Anthropic-backed implementation, not hardcoded per-document logic.
