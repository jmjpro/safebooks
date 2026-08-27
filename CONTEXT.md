# Document Data Extraction

Pipeline that reads Order Form and Purchase Order PDFs from a folder, extracts their fields via an LLM, and stores the results in Postgres.

## Language

**Sales Order (SO)**:
The internal record type for a processed Order Form document. Stored in the `so` / `so_items` tables.
_Avoid_: Order Form (reserved for the source document type)

**Purchase Order (PO)**:
Both the source document type and the internal record type it becomes. Stored in the `po` / `po_items` tables.

**Order Form**:
The source PDF document type that becomes a Sales Order (SO) once processed.
_Avoid_: Sales Order (reserved for the internal record)

**Document**:
A single PDF dropped in the input folder, classified by content — not filename — as an Order Form or a Purchase Order.
_Avoid_: File (use Document when referring to a business document; File is fine for filesystem-level code)

**Document Type**:
The classification of a Document as Order Form (→ SO) or Purchase Order (→ PO), determined by the pipeline from document content.

**Customer**:
The counterparty named in a document's billing fields (`Bill To` / `Buyer`), i.e. whoever the document is billed to. Distinct from the assignment spec's product-level use of "customer" (the business operating this system), which this build doesn't model.
_Avoid_: Client, Buyer, Vendor, Account

**Structured Field**:
A field with a directly-labeled value in the source document: start date, end date, amount, payment terms, billing address, signature, items.

**Natural Language Field**:
A field whose value must be inferred from prose rather than read off a label. Covers the two Special Terms fields below.

**Special Terms**:
Free-text contract provisions extracted as natural-language data.

**Burst**:
A Special Term describing the customer's right to exceed contracted usage by a set percentage at no additional charge. Modeled as a document-level field, not per-item — no sample document varies it by line item despite the assignment spec's "item level" wording (see [ADR 0002](docs/adr/0002-burst-as-document-level-field.md)).

**Technical Account Manager (TAM)**:
A Special Term describing a dedicated account manager assigned for the contract term.

**Item**:
One line entry in a document's items table: product name, quantity, price, total amount. Sample documents' items tables also carry a per-row Start Date/End Date, but this isn't captured — it's redundant with the document-level Start Date/End Date already extracted (see [ADR 0004](docs/adr/0004-item-level-dates-not-captured.md)).

**needs_review status**:
The outcome for a document where at least one field failed to extract or validate after retries. The record is still saved with whatever fields succeeded, flagged for manual follow-up, rather than the document being dropped.
