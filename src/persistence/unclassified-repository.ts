import type { Pool } from 'pg'
import type { ExtractedFields } from '../extraction/field-extractor.js'
import { EXTRACTED_FIELDS_COLUMNS, extractedFieldsValues } from './extracted-fields-row.js'

export interface SaveUnclassifiedInput {
  // Which of the two ways a document ends up here — see the document_type column comment in
  // schema.sql and issue 08 (.scratch/document-extraction-pipeline/issues).
  documentType: 'Unclassified' | 'ExtractionFailed'
  fields: Partial<ExtractedFields>
  sourceFilename: string
}

// A Document the extractor couldn't classify as OrderForm or PurchaseOrder. Always saved as
// 'needs_review' — see ADR 0006 — so, unlike saveSo/savePo, status isn't a caller-supplied input.
export async function saveUnclassified(
  pool: Pool,
  input: SaveUnclassifiedInput,
): Promise<{ id: number }> {
  const { rows } = await pool.query(
    `INSERT INTO unclassified_documents (
       document_type, ${EXTRACTED_FIELDS_COLUMNS}, status, source_filename, processed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'needs_review',$11, now())
     RETURNING id`,
    [input.documentType, ...extractedFieldsValues(input.fields), input.sourceFilename],
  )
  return { id: rows[0].id as number }
}
