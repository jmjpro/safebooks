# 10: Parallelize pipeline processing and show live per-file stage status on the CLI

**What to build:** Process files concurrently (bounded) instead of one at a time, and replace the current scrolling `onProgress` log lines with a fixed-position, per-file status grid that updates in place as each file moves through its stages.

**Status:** ready-for-agent

## Background

A full `npm run pipeline` run against the 4 sample files takes ~50s (issue 09's Comments). `runPipeline` (`src/pipeline/run.ts:41-89`) is a plain sequential `for` loop: `readFileSync` → `extractWithRetries` (up to 3 sequential LLM calls, `src/pipeline/retry-extraction.ts`) → DB write, fully awaited before moving to the next file. Nothing else in the current implementation contends for the same time — this loop structure is the entire source of the wall-clock cost, and it's the only place inter-file work could run in parallel.

Reached via a grilling session; every item below was an explicit decision, not an assumption.

### Parallelization

- [x] Run each file's own pipeline (read → LLM → DB, stages sequential *within* a file) concurrently across files, bounded by a concurrency limit.
- [x] Limit is configurable (flag and/or env var), default **5**.
- [x] One file's failure (at any stage) must not abort other files' in-flight or queued work. Let the whole batch finish, then exit non-zero if anything failed.
- [x] File discovery stays as-is: `readdirSync` upfront (`run.ts:36`) — the full file list is already known before any processing starts, which the display design below depends on.
- [x] Convert the read stage from the current synchronous `readFileSync` (`run.ts:44`) to async (`fs/promises`), so one file's disk read can't block another file's in-flight work under concurrency.
- [x] Confirm the shared `pg.Pool` (`index.ts:19`) tolerates 5 concurrent checkouts without changes — `savePo`/`saveSo` already call `pool.connect()` for a dedicated client per transaction (`po-repository.ts:15`, `so-repository.ts:15`); `pg`'s default pool max (10) comfortably covers a limit of 5.

### CLI display

- [x] Three stages shown per file, left to right: **READ → LLM → DB**. Each file gets one fixed row for the whole run; all rows are printed upfront (in file-discovery order, never reordered) since the full file list is known before work starts.
- [x] Plain header row above the grid naming the columns (e.g. `FILE  READ  LLM  DB`).
- [x] Per-stage visual states:
  - **Queued** (not yet started): a dim/distinct waiting indicator — must read as "will run soon," not "stalled."
  - **Running**: a spinner. The **LLM stage only** also shows a live retry-attempt counter next to the spinner (e.g. `⠋ attempt 2/3`), reflecting `extractWithRetries`'s existing up-to-3-attempt loop (`retry-extraction.ts:67-87`).
  - **Success**: green check.
  - **Warn** (**LLM stage only**): a distinct yellow/warn icon for `needs_review` outcomes (field errors survived retries, `run.ts:51`) and for `Unclassified` (LLM legitimately found no matching type) — these are not clean passes and must not render identically to `processed`. `ExtractionFailed` is **not** a warn state — see Failure below.
  - **Failure**: red x — `ExtractionFailed` (all 3 attempts died/unparsable, `anthropic-field-extractor.ts:61-78`), a read error (permissions, file vanished mid-run, unreadable), or a DB write error (`run.ts:86-88`'s current outer try/catch).
  - **Unreached**: a dash for any stage that never got to run because an earlier stage in the same file failed — must be visually distinct from *queued*, so a finished-but-failed row isn't mistaken for one still waiting its turn.
- [x] Render via the `log-update` package (new dependency) — rewrites the fixed multi-line block in place. No existing TUI/progress library is present today (confirmed: no `ora`/`listr2`/`log-update`/`cli-progress` in `package.json`).
- [x] Non-TTY fallback: when `process.stdout.isTTY` is false (piped output, CI logs, redirected to a file), skip in-place redraw entirely and fall back to flat sequential status-change lines (one line per stage transition), since cursor-repositioning escape codes corrupt non-TTY output.
- [x] The existing `onProgress` callback plumbing (`run.ts:34,37,43`; `retry-extraction.ts:71,73,81`) gets replaced/adapted to drive per-file, per-stage state transitions instead of the current free-text log lines.

### After the run

- [x] Keep the existing issue-09 end-of-run recap (persisted-rows table via `print-persisted-rows.ts` + the failures list) printing once after the whole batch settles and the live grid is done — it's the copy-pasteable artifact of a run; the live grid is transient and shouldn't replace it.

## Comments

Implemented largely as specced. `runPipeline` (`src/pipeline/run.ts`) now discovers files via `readdir`/`readFile` (`node:fs/promises`, replacing the old synchronous `readdirSync`/`readFileSync`) and processes them through `p-limit` (npm), bounded by `RunPipelineOptions.concurrency` (default `DEFAULT_CONCURRENCY = 5`, exported). Each file's `processFile` still does read → `extractWithRetries` → DB write strictly in order; only *different* files' `Promise`s overlap. `results`/`failures` are assembled from `Promise.all`'s settled outcomes after the fact, so their order is stable (input-file order) regardless of completion order — no test happened to depend on completion order, but this keeps the final summary deterministic anyway.

**Stage-state model** lives in the new `src/cli/live-progress-view.ts`: `Stage = 'read' | 'llm' | 'db'`, `StageState` a tagged union (`queued` / `running` (`{attempt?, maxAttempts?}`) / `success` / `warn` / `failure` (`{error}`) / `unreached`). `run.ts` only depends on the `ProgressListener`/`LiveProgressView` *types* from that module — the concrete renderer is injected via `RunPipelineOptions.createProgressView: (filenames) => LiveProgressView`, called once right after file discovery (so it gets the full, fixed filename list before any processing starts) and `.stop()`'d in a `finally`. Tests never pass this option, so `runPipeline` stays renderer-agnostic and the existing stub-extractor test suite needed no changes.

**One real behavioral subtlety vs. the checklist's "Unreached" wording**: `ExtractionFailed` does *not* leave the DB stage `unreached` — per the pre-existing persistence logic (issue 08), a totally-failed extraction is still written to `unclassified_documents`, so the DB stage always runs after the LLM stage completes (with any outcome). `unreached` in practice only fires when the **read** stage throws (file vanished, permissions, `EISDIR` from a same-named directory) — verified in `extractWithRetries`/`AnthropicFieldExtractor.extract()`, which catch their own errors and return `ExtractionFailed` as data rather than throwing, so the LLM stage's own `catch` block is a safety net for a genuinely unexpected bug, not a normal code path.

**Rendering**: `createLiveProgressView` picks `log-update` (npm)-backed in-place redraw only when `process.stdout.isTTY` **and** `columns`/`rows` are both `> 0`; otherwise it falls back to flat `console.log` lines, one per stage transition. The extra rows/columns check wasn't in the original spec — discovered while manually verifying the grid (via a throwaway `script`-wrapped run) that `log-update` silently produces *zero* output when the stream reports `rows === 0`, which some non-interactive pty wrappers do even though `isTTY` is `true`. A real user terminal always reports nonzero dimensions, so this only matters for a broken/synthetic TTY, but the fix is one extra guard and keeps that case from going completely silent for the whole run. The grid itself (`renderGrid`, pure and exported for testability) computes column widths from `STAGE_LABELS` and reserves room for `attempt 3/3`; a spinner frame counter is advanced by a `setInterval(80ms)` that also re-renders so the spinner animates between state-change events, not just on them.

**Follow-up from a real run**: after watching an actual `npm run pipeline` run, the pre-existing per-file `console.log(`${filename} -> ${table}#${id} (${status})`)` summary loop in `index.ts` turned out fully redundant with the new grid — the grid already ends each run showing every filename with its final per-stage icon, and the recap table (`printPersistedRows`) already prints each row's own `#id` and `source_filename`, so that third line just repeated both. Removed it; the `failures` loop stays (a failed file gets no recap row, so its error message is only ever printed there). README's example output updated to match.

`index.ts` adds `--concurrency=N` (or `PIPELINE_CONCURRENCY` env var) parsing, defaulting to `DEFAULT_CONCURRENCY`; `inputDir` is now taken as the first non-`--` argument rather than always `argv[2]`, so `--concurrency` can be passed without a positional `inputDir`. Also added: `process.exitCode = 1` when `failures.length > 0` (previously the run always exited 0 even if some files threw) — an `ExtractionFailed`/`Unclassified` document is a successful pipeline outcome and doesn't count toward this.

**Tests**: `tests/pipeline/parallel-processing.test.ts` (new, against the real test DB with stub extractors — no real LLM calls) covers overlap actually happening under `concurrency: 4` and *not* happening under `concurrency: 1` (via an extractor that tracks in-flight call count with an artificial delay), failure isolation (one file throwing doesn't stop another from completing), the read-failure → `unreached`/`unreached` cascade (using a directory named `*.pdf` to force `EISDIR`), and that `createProgressView` receives the full filename list upfront plus the exact expected event sequence for a clean single-file run. `tests/unit/live-progress-view.test.ts` (new) covers `renderGrid`'s pure output (header, row order, all six state icons/attempt counter, the "unknown filename" guard) and the flat non-TTY fallback's line format. Full existing `test:unit`/`test:pipeline` suites pass unchanged; `format`/`lint`/`typecheck` clean.

Added `tests/support/preview-live-progress.ts` (manual dev tool, not part of `npm test`) — runs the real `runPipeline` + live grid against throwaway files and a stub extractor with artificial per-file delays hitting every visual state (processed / needs_review / Unclassified / ExtractionFailed / unreadable), against `TEST_DATABASE_URL`. Used it to verify the full event sequence end-to-end (confirmed via the flat-fallback trace, since this sandbox's available pty reports zero rows/columns — see above); `renderGrid`'s own unit tests cover the grid's actual visual content directly. README's Usage section updated to describe `--concurrency`, the grid's icon legend, the non-TTY fallback, the new exit-code behavior, and this preview tool.
