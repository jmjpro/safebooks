# Document Data Extraction

Pipeline that reads Order Form and Purchase Order PDFs from a folder, classifies each by
content, extracts their fields via an LLM, and stores the results in Postgres as Sales Order
(SO) or Purchase Order (PO) records. See [CONTEXT.md](CONTEXT.md) for domain vocabulary and
[docs/adr](docs/adr) for the design decisions behind the schema.

## Setup

Prerequisites: Node (version pinned in [.tool-versions](.tool-versions)), and Docker — via
[colima](https://github.com/abiosoft/colima) (`colima start`) or Docker Desktop — for
Postgres.

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
npm run pipeline [inputDir]
```

`inputDir` defaults to `sample-input/`, which contains the 4 sample documents (2 Order Form
customers, 2 Purchase Order customers). Each `.pdf` in the folder is classified, its fields
extracted, and the result written to Postgres. The command prints one line per document:

```
ACME Order From.pdf -> so#1 (processed)
CloudShield Order Form.pdf -> so#2 (processed)
Purchase Order – BrightOps Analytics Ltd.pdf -> po#1 (processed)
Purchase Order – NovaFleet Technologies Inc.pdf -> po#2 (processed)
```

An Order Form document is stored in `so`/`so_items`; a Purchase Order document is stored in
`po`/`po_items`; a document that can't be classified as either is stored in
`unclassified_documents` (see [ADR 0006](docs/adr/0006-unclassified-documents-table.md)).
Re-running the command against the same folder reprocesses every document in it again,
inserting new rows rather than updating existing ones.

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
configured, since they're invoked with `--env-file=.env` and read `TEST_DATABASE_URL`.
`test:unit` needs neither.

## Other scripts

- `npm run lint` / `npm run format` / `npm run format:check` — ESLint / Prettier.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — compiles `src/` to `dist/`.
