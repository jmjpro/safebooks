# Document Data Extraction

Pipeline that reads Order Form and Purchase Order PDFs from a folder, classifies each by
content, extracts their fields via an LLM, and stores the results in Postgres as Sales Order
(SO) or Purchase Order (PO) records. See [CONTEXT.md](CONTEXT.md) for domain vocabulary and
[docs/adr](docs/adr) for the design decisions behind the schema.

## Setup

Prerequisites:

- **Node 24+** (tested with v24.20.0; see [.tool-versions](.tool-versions) if you use asdf).
- **Docker**, for Postgres — via [colima](https://github.com/abiosoft/colima)
  (`colima start`) or Docker Desktop.

1. Install dependencies:

   ```
   npm install
   ```

2. Configure environment variables:

   ```
   cp .env.example .env
   ```

   Then fill in `ANTHROPIC_API_KEY` in `.env` with a real Anthropic API key. The other three
   values in `.env.example` (`ANTHROPIC_MODEL`, `DATABASE_URL`, `TEST_DATABASE_URL`) already
   match what `npm run db:up` below provisions, so they work unchanged.

3. Start Postgres:

   ```
   npm run db:up
   ```

   This starts a `postgres:18` container (`safebooks-pg`, port 5432) with two databases:
   `safebooks` (app) and `safebooks_test` (test suite). Data persists in the
   `safebooks-pg-data` volume across restarts, so this is safe to re-run. `npm run db:down`
   stops the container.

The pipeline creates its own tables on first run (see [Usage](#usage) below) — no separate
migration step is needed.

## Usage

Run the pipeline against a folder of documents:

```
npm run pipeline [inputDir] [--concurrency=N]
```

`inputDir` defaults to `sample-input/`, which contains the 4 sample documents (2 Order Form
customers, 2 Purchase Order customers). Each `.pdf` in the folder is classified, its fields
extracted, and the result written to Postgres. Files are processed concurrently, up to
`--concurrency` (or the `PIPELINE_CONCURRENCY` env var; default 5) at a time — each file's own
steps (read → LLM → DB) still run in order, only different files overlap.

While the run is in progress, a fixed grid tracks every file's `READ`/`LLM`/`DB` stage in
place — a dot while queued, a spinner (with a live retry counter on `LLM`) while running, then
a check, a warning (`LLM` only, for `needs_review`/`Unclassified` outcomes), or an x once that
stage settles:

```
FILE                                        READ  LLM   DB
ACME Order From.pdf                         ✔     ✔     ✔
CloudShield Order Form.pdf                  ✔     ⠹ 2/3 ·
Purchase Order – BrightOps Analytics.pdf    ✔     ⚠     ✔
Purchase Order – NovaFleet Technologies.pdf ✔     ✔     ⠋
```

When stdout isn't a real terminal (piped output, CI logs), the grid falls back to one flat
line per stage transition instead, since in-place redraw only works on a real TTY. While
iterating on the grid itself, `tests/support/preview-live-progress.ts` exercises every visual
state (processed, needs_review, Unclassified, ExtractionFailed, an unreadable file) against a
stub extractor and the test DB, with artificial delays instead of real LLM calls:

```
node --import dotenv/config --import tsx tests/support/preview-live-progress.ts
```

A file that failed outright (couldn't be read, or hit a DB error) also gets its error message
printed once the run finishes — the grid's `x` shows _which_ stage failed, but not why, and a
failed file gets no row in the recap below to explain itself either. A file that succeeded
doesn't get its own separate summary line: the grid already shows its filename and final
per-stage status, and the recap below shows each row's own `#id` and `source_filename`, so a
third "-> table#id" line would just repeat both.

The command exits non-zero if any file failed outright — an `ExtractionFailed`/`Unclassified`
document is still a _successful_ pipeline run and doesn't count.

An Order Form document is stored in `so`/`so_items`; a Purchase Order document is stored in
`po`/`po_items`; a document that can't be classified as either is stored in
`unclassified_documents` (see [ADR 0006](docs/adr/0006-unclassified-documents-table.md)).
Re-running the command against the same folder reprocesses every document in it again,
inserting new rows rather than updating existing ones.

Once the run finishes, the command prints the rows it just persisted for each table
touched in that run (`so`, `so_items`, `po`, `po_items`, `unclassified_documents`), so you can
see the extracted data — including the full Special Terms prose — without a separate `psql`
query. `so`/`po`/`unclassified_documents` print as an expanded `field: value` block per row
(like `psql`'s `\x` display — they have 13-14 columns, too many for one wide table to stay
readable); `so_items`/`po_items` print as a normal wide table (product/qty/price side by
side) — only 6 narrow columns, so a table reads better than 6 separate blocks per item.

While iterating on that display formatting itself, `tests/support/preview-persisted-rows.ts`
re-prints whatever's already in the dev DB without re-running the pipeline (no LLM call):

```
node --import tsx tests/support/preview-persisted-rows.ts
```

To inspect the results directly in Postgres:

```
docker exec safebooks-pg psql -U safebooks -d safebooks -c \
  "SELECT id, customer, status, source_filename FROM so;"
```

(swap `so` for `po` or `unclassified_documents` as needed).

### `needs_review` status

Every `so`/`po`/`unclassified_documents` row has a `status` of either `processed` or
`needs_review`:

- **`processed`**: every field extracted and validated successfully (after retries, if
  needed).
- **`needs_review`**: at least one field failed to extract or failed validation (e.g. a date
  that didn't parse to `mm-dd-yyyy`, an amount that wasn't numeric) after 3 attempts. The
  record is still saved with whatever fields did succeed — the failed fields are left
  null — rather than the document being dropped, so it can be found and corrected by a
  human later. `source_filename` traces the row back to the original PDF.

An unclassified document (Document Type is neither Order Form nor Purchase Order) always gets
`needs_review`, regardless of whether its individual fields happened to extract cleanly.

## Model selection

`ANTHROPIC_MODEL` in `.env` selects which Claude model `AnthropicFieldExtractor` uses (defaults
to `claude-haiku-4-5` if unset). Override it to compare models — no code changes needed:

```
ANTHROPIC_MODEL=claude-sonnet-5 npm run pipeline
```

`claude-haiku-4-5` is the default per the comparison in issue 01.5
(`.scratch/document-extraction-pipeline/issues/01.5-model-comparison-haiku-sonnet-opus.md`):
against the 4 sample documents it matched `claude-opus-5`'s field-level accuracy while running
faster and at roughly a fifth of the cost. `npm run compare-models` re-runs that comparison
(extraction only, no persistence) against whatever model `ANTHROPIC_MODEL` currently points at.

## Testing

```
npm test
```

runs three suites in order:

- `npm run test:unit` — pure unit tests (date parsing, retry logic), no external
  dependencies.
- `npm run test:pipeline` — pipeline mechanics (retry-then-recover, `needs_review` vs
  `processed` status, SO/PO table routing, the unclassifiable-document path) against a real
  test Postgres database, with the `FieldExtractor` swapped for a stub — no live LLM calls.
- `npm run test:eval` — the end-to-end accuracy eval: runs the real pipeline against the real
  sample documents in `sample-input/`, using the real Anthropic API and a real test database,
  and checks extracted fields against hand-verified expected values. **This suite makes live
  Anthropic API calls** (billed against `ANTHROPIC_API_KEY`) and takes noticeably longer than
  the other two.

`test:pipeline` and `test:eval` require Postgres running (`npm run db:up`) and `.env`
configured, since they're invoked with `--import dotenv/config` and read `TEST_DATABASE_URL`.
`test:unit` needs neither.

## Other scripts

- `npm run lint` / `npm run format` / `npm run format:check` — ESLint / Prettier.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — compiles `src/` to `dist/`.
