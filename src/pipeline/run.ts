import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import type { FieldExtractor } from '../extraction/field-extractor.js'
import { savePo } from '../persistence/po-repository.js'
import { saveSo } from '../persistence/so-repository.js'
import { saveUnclassified } from '../persistence/unclassified-repository.js'
import { extractWithRetries } from './retry-extraction.js'

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
      const extraction = await extractWithRetries(extractor, { filename, content })
      const status = Object.keys(extraction.fieldErrors).length === 0 ? 'processed' : 'needs_review'

      if (extraction.documentType === 'OrderForm') {
        const { id } = await saveSo(pool, {
          fields: extraction.fields,
          items: extraction.items,
          status,
          sourceFilename: filename,
        })
        results.push({ filename, table: 'so', id, status })
      } else if (extraction.documentType === 'PurchaseOrder') {
        const { id } = await savePo(pool, {
          fields: extraction.fields,
          items: extraction.items,
          status,
          sourceFilename: filename,
        })
        results.push({ filename, table: 'po', id, status })
      } else {
        // Unclassifiable document (genuinely 'Unclassified' or a total 'ExtractionFailed'):
        // recorded (not dropped), never force-fit into so/po. See ADR 0006 and issues 05 and
        // 08 (.scratch/document-extraction-pipeline/issues).
        const { id } = await saveUnclassified(pool, {
          documentType: extraction.documentType,
          fields: extraction.fields,
          sourceFilename: filename,
        })
        results.push({
          filename,
          table: 'unclassified_documents',
          id,
          status: 'needs_review',
          documentType: extraction.documentType,
        })
      }
    } catch (err) {
      failures.push({ filename, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { results, failures }
}
