# A dedicated `unclassified_documents` table for documents that don't classify

A Document the extractor can't classify as an Order Form or a Purchase Order (Document Type `Unclassified`) must still be recorded rather than dropped, but per ADR 0001 `so`/`po` are for classified records — inserting a placeholder row into either would force-fit an unclassified Document into a schema that presumes its type.

We added a third table, `unclassified_documents`, mirroring `so`/`po`'s field columns (customer, dates, amount, etc.) minus the items tables: an unclassifiable Document still gets whatever fields the extractor managed to read off it recorded, for the same "don't lose partial data" reason `needs_review` keeps partial `so`/`po` rows, but item-line extraction for a document we couldn't even classify is more likely noise than signal, and no sample document exercises this path to validate it against.

ADR 0001 anticipated this: "a future reader adding a third document type should weigh collapsing to a unified schema at that point, since the DRY case gets stronger with each additional type." We didn't collapse the tables themselves — they still diverge on `so_items`/`po_items` vs. no items table, and on `status`'s allowed values — but the field-column list and value-mapping that _is_ identical across all three (`src/persistence/extracted-fields-row.ts`) is now shared, so a field addition/rename touches one place instead of three.

Status on this table is always `needs_review` — never `processed` — since an unclassified Document always needs a human to look at it regardless of whether its individual fields happened to parse cleanly.
