import type { Pool } from 'pg'
import type { PipelineResult } from '../pipeline/run.js'

export interface PersistedRows {
  so: Record<string, unknown>[]
  soItems: Record<string, unknown>[]
  po: Record<string, unknown>[]
  poItems: Record<string, unknown>[]
  unclassifiedDocuments: Record<string, unknown>[]
}

// Re-fetches the rows a pipeline run just wrote, keyed off the ids runPipeline already
// returned, so the CLI can print what actually landed in Postgres instead of just an
// id/status summary. See issue 09 (.scratch/document-extraction-pipeline/issues).
export async function fetchPersistedRows(
  pool: Pool,
  results: PipelineResult[],
): Promise<PersistedRows> {
  const soIds = idsFor(results, 'so')
  const poIds = idsFor(results, 'po')
  const unclassifiedIds = idsFor(results, 'unclassified_documents')

  const [so, po, unclassifiedDocuments, soItems, poItems] = await Promise.all([
    fetchByIds(pool, 'so', soIds),
    fetchByIds(pool, 'po', poIds),
    fetchByIds(pool, 'unclassified_documents', unclassifiedIds),
    fetchByParentIds(pool, 'so_items', 'so_id', soIds),
    fetchByParentIds(pool, 'po_items', 'po_id', poIds),
  ])

  return { so, soItems, po, poItems, unclassifiedDocuments }
}

function idsFor(results: PipelineResult[], table: PipelineResult['table']): number[] {
  return results.filter((r) => r.table === table).map((r) => r.id)
}

// `table`/`parentColumn` are always one of the fixed literals passed by fetchPersistedRows
// above, never caller-supplied input, so string-building the identifier here is safe.
async function fetchByIds(
  pool: Pool,
  table: string,
  ids: number[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = ANY($1) ORDER BY id`, [ids])
  return rows
}

async function fetchByParentIds(
  pool: Pool,
  table: string,
  parentColumn: string,
  parentIds: number[],
): Promise<Record<string, unknown>[]> {
  if (parentIds.length === 0) return []
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE ${parentColumn} = ANY($1) ORDER BY id`,
    [parentIds],
  )
  return rows
}
