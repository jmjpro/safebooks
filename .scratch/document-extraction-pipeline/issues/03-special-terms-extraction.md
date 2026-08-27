# 03: Special Terms extraction (Burst + TAM)

**What to build:** Extract Burst and Technical Account Manager Special Terms as document-level natural language fields, populated on `so` and `po` records for both document types.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Running the CLI against a sample document whose Special Terms section mentions a Burst allowance produces an `so`/`po` row with a populated Burst field reflecting that allowance.
- [ ] Running the CLI against a sample document whose Special Terms section names a Technical Account Manager produces an `so`/`po` row with that field populated.
- [ ] Burst and TAM are stored as fields on the `so`/`po` row itself, not on `so_items`/`po_items`.
- [ ] A document with no Special Terms section leaves Burst/TAM null rather than failing extraction.
