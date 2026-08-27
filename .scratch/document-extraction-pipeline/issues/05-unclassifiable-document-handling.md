# 05: Unclassifiable document handling

**What to build:** A document that can't be classified as either Order Form or Purchase Order is still recorded rather than silently dropped.

**Blocked by:** 04

**Status:** ready-for-human

- [x] Given a `FieldExtractor` stub that returns an unrecognized/unknown document type, running the CLI against that document results in a persisted record with `status = "needs_review"`, rather than no record being created.
- [x] No row is written to `so` or `po` for an unclassifiable document (it isn't force-fit into either table).
- [x] The persisted record retains the source document's filename so it can be traced back to the original PDF.

## Comments

Implemented via a new `unclassified_documents` table (ADR 0006) and `saveUnclassified` repository function, wired into `runPipeline`'s existing classification branch. Status is hardcoded to `needs_review` there (never `processed`) since an unclassified Document always needs human review regardless of individual field success. Covered by `tests/pipeline/unclassifiable-document.test.ts`.
