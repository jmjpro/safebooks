import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import type { FieldExtractor } from '../extraction/field-extractor.js'
import { saveSo } from '../persistence/so-repository.js'

export interface PipelineResult {
  filename: string
  table: 'so'
  id: number
  status: 'processed' | 'needs_review'
}

export interface PipelineFailure {
  filename: string
  error: string
}

export interface PipelineRunSummary {
  results: PipelineResult[]
  failures: PipelineFailure[]
}

export async function runPipeline(
  inputDir: string,
  extractor: FieldExtractor,
  pool: Pool,
): Promise<PipelineRunSummary> {
  const filenames = readdirSync(inputDir).filter((f) => f.toLowerCase().endsWith('.pdf'))
  const results: PipelineResult[] = []
  const failures: PipelineFailure[] = []

  for (const filename of filenames) {
    try {
      const content = readFileSync(join(inputDir, filename))
      const extraction = await extractor.extract({ filename, content })
      const status = Object.keys(extraction.fieldErrors).length === 0 ? 'processed' : 'needs_review'

      if (extraction.documentType === 'OrderForm') {
        const { id } = await saveSo(pool, {
          fields: extraction.fields,
          items: extraction.items,
          status,
          sourceFilename: filename,
        })
        results.push({ filename, table: 'so', id, status })
      } else {
        throw new Error(`Document type "${extraction.documentType}" is not yet supported`)
      }
    } catch (err) {
      failures.push({ filename, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { results, failures }
}
