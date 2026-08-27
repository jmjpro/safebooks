# 04: Retry and needs_review handling

**What to build:** Per-field retry logic and `needs_review` status assignment so that a document with a partially failing extraction is still saved, with whatever fields succeeded, rather than dropped or fully discarded.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Given a `FieldExtractor` stub that fails a field's extraction on the first attempt and succeeds on a retry, the resulting record has `status = "processed"` and the field is populated correctly.
- [ ] Given a `FieldExtractor` stub that fails a field's extraction on every attempt (up to the retry limit), the resulting record has `status = "needs_review"`, with that field null/absent and all other successfully-extracted fields populated.
- [ ] A failing field is retried up to 2 additional times (3 attempts total) before being treated as failed.
- [ ] A document that extracts and validates every field on the first attempt is unaffected: still saved with `status = "processed"`.
