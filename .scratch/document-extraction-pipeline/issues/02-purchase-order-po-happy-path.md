# 02: Purchase Order → PO happy path

**What to build:** Extend the pipeline built in 01 to correctly classify and route Purchase Order documents to the `po`/`po_items` tables instead of `so`/`so_items`.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Running the CLI against a folder containing a single real Purchase Order sample document produces exactly one new row in `po` (not `so`), with `status = "processed"`.
- [ ] The `po` row's Start Date, End Date, Amount, Payment Terms, Billing Address, and Customer Signature match the values in the source document.
- [ ] Each item produces a corresponding row in `po_items`, linked to the parent `po` row, with matching product name, quantity, price, and total amount.
- [ ] Running the CLI against a folder containing one Order Form and one Purchase Order document produces one row in `so` and one row in `po`, each in the correct table.
- [ ] Document type is determined from document content, not filename (e.g., renaming a Purchase Order sample file to something generic still routes it to `po`).
