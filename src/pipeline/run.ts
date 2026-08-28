import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pLimit from 'p-limit'
import type { Pool } from 'pg'
import type { LiveProgressView, ProgressListener } from '../cli/live-progress-view.js'
import type { FieldExtractionResult, FieldExtractor } from '../extraction/field-extractor.js'
import { savePo } from '../persistence/po-repository.js'
import { saveSo } from '../persistence/so-repository.js'
import { saveUnclassified } from '../persistence/unclassified-repository.js'
import { extractWithRetries, MAX_EXTRACTION_ATTEMPTS } from './retry-extraction.js'

// Bound on how many files' pipelines (read -> LLM -> DB) run concurrently. Overridable via
// RunPipelineOptions.concurrency. See issue 10 (.scratch/document-extraction-pipeline/issues).
export const DEFAULT_CONCURRENCY = 5

export interface PipelineResult {
  filename: string
  table: 'so' | 'po' | 'unclassified_documents'
  id: number
  status: 'processed' | 'needs_review'
  // Set only for an 'unclassified_documents' row: which of the two ways it ended up there —
  // see issue 08 (.scratch/document-extraction-pipeline/issues).
  documentType?: 'Unclassified' | 'ExtractionFailed'
}

export interface PipelineFailure {
  filename: string
  error: string
}

export interface PipelineRunSummary {
  results: PipelineResult[]
  failures: PipelineFailure[]
}

export interface RunPipelineOptions {
  concurrency?: number
  // Given the full, upfront list of discovered filenames, returns a view to drive with
  // per-file, per-stage progress events for the duration of the run. Left undefined (e.g. in
  // tests), progress events are simply not observed by anything.
  createProgressView?: (filenames: string[]) => LiveProgressView
}

type FileOutcome = { ok: true; result: PipelineResult } | { ok: false; failure: PipelineFailure }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Debug-only knob (unset by default, so it never affects a real run): stretches the read and
// DB stages, which normally complete near-instantly, so they're visible in the live grid
// instead of flashing past — useful for eyeballing that concurrency is actually happening.
// Usage: PIPELINE_DEBUG_DELAY_MS=1500 npm run pipeline
const DEBUG_DELAY_MS = Number(process.env.PIPELINE_DEBUG_DELAY_MS) || 0

async function debugDelay(): Promise<void> {
  if (DEBUG_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, DEBUG_DELAY_MS))
  }
}

async function processFile(
  filename: string,
  inputDir: string,
  extractor: FieldExtractor,
  pool: Pool,
  onProgress: ProgressListener | undefined,
): Promise<FileOutcome> {
  const emit: ProgressListener = (file, stage, state) => onProgress?.(file, stage, state)

  let content: Buffer
  try {
    emit(filename, 'read', { kind: 'running' })
    await debugDelay()
    content = await readFile(join(inputDir, filename))
    emit(filename, 'read', { kind: 'success' })
  } catch (err) {
    const error = errorMessage(err)
    emit(filename, 'read', { kind: 'failure', error })
    emit(filename, 'llm', { kind: 'unreached' })
    emit(filename, 'db', { kind: 'unreached' })
    return { ok: false, failure: { filename, error } }
  }

  let extraction: FieldExtractionResult
  try {
    extraction = await extractWithRetries(
      extractor,
      { filename, content },
      MAX_EXTRACTION_ATTEMPTS,
      (attempt, maxAttempts) => emit(filename, 'llm', { kind: 'running', attempt, maxAttempts }),
    )
  } catch (err) {
    // extractWithRetries/extract() are expected to report failure as data
    // (documentType: 'ExtractionFailed'), not throw — this is a safety net for a genuinely
    // unexpected bug, not a normal outcome.
    const error = errorMessage(err)
    emit(filename, 'llm', { kind: 'failure', error })
    emit(filename, 'db', { kind: 'unreached' })
    return { ok: false, failure: { filename, error } }
  }

  const status = Object.keys(extraction.fieldErrors).length === 0 ? 'processed' : 'needs_review'
  emit(
    filename,
    'llm',
    extraction.documentType === 'ExtractionFailed'
      ? { kind: 'failure', error: 'extraction failed after all retry attempts' }
      : status === 'needs_review' || extraction.documentType === 'Unclassified'
        ? { kind: 'warn' }
        : { kind: 'success' },
  )

  try {
    emit(filename, 'db', { kind: 'running' })
    await debugDelay()
    let result: PipelineResult

    if (extraction.documentType === 'OrderForm') {
      const { id } = await saveSo(pool, {
        fields: extraction.fields,
        items: extraction.items,
        status,
        sourceFilename: filename,
      })
      result = { filename, table: 'so', id, status }
    } else if (extraction.documentType === 'PurchaseOrder') {
      const { id } = await savePo(pool, {
        fields: extraction.fields,
        items: extraction.items,
        status,
        sourceFilename: filename,
      })
      result = { filename, table: 'po', id, status }
    } else {
      // Unclassifiable document (genuinely 'Unclassified' or a total 'ExtractionFailed'):
      // recorded (not dropped), never force-fit into so/po. See ADR 0006 and issues 05 and
      // 08 (.scratch/document-extraction-pipeline/issues).
      const { id } = await saveUnclassified(pool, {
        documentType: extraction.documentType,
        fields: extraction.fields,
        sourceFilename: filename,
      })
      result = {
        filename,
        table: 'unclassified_documents',
        id,
        status: 'needs_review',
        documentType: extraction.documentType,
      }
    }

    emit(filename, 'db', { kind: 'success' })
    return { ok: true, result }
  } catch (err) {
    const error = errorMessage(err)
    emit(filename, 'db', { kind: 'failure', error })
    return { ok: false, failure: { filename, error } }
  }
}

export async function runPipeline(
  inputDir: string,
  extractor: FieldExtractor,
  pool: Pool,
  options: RunPipelineOptions = {},
): Promise<PipelineRunSummary> {
  const { concurrency = DEFAULT_CONCURRENCY, createProgressView } = options
  const filenames = (await readdir(inputDir)).filter((f) => f.toLowerCase().endsWith('.pdf'))

  const view = createProgressView?.(filenames)
  const limit = pLimit(concurrency)

  try {
    const outcomes = await Promise.all(
      filenames.map((filename) =>
        limit(() => processFile(filename, inputDir, extractor, pool, view?.onProgress)),
      ),
    )

    const results: PipelineResult[] = []
    const failures: PipelineFailure[] = []
    for (const outcome of outcomes) {
      if (outcome.ok) {
        results.push(outcome.result)
      } else {
        failures.push(outcome.failure)
      }
    }

    return { results, failures }
  } finally {
    view?.stop()
  }
}
