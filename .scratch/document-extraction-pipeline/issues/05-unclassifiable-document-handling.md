# 05: Unclassifiable document handling

**What to build:** A document that can't be classified as either Order Form or Purchase Order is still recorded rather than silently dropped.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Given a `FieldExtractor` stub that returns an unrecognized/unknown document type, running the CLI against that document results in a persisted record with `status = "needs_review"`, rather than no record being created.
- [ ] No row is written to `so` or `po` for an unclassifiable document (it isn't force-fit into either table).
- [ ] The persisted record retains the source document's filename so it can be traced back to the original PDF.
