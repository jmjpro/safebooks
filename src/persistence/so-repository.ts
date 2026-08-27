import type { Pool } from 'pg'
import type { ExtractedFields, ExtractedItem } from '../extraction/field-extractor.js'

export type SoStatus = 'processed' | 'needs_review'

export interface SaveSoInput {
  fields: Partial<ExtractedFields>
  items: ExtractedItem[]
  status: SoStatus
  sourceFilename: string
}

export async function saveSo(pool: Pool, input: SaveSoInput): Promise<{ id: number }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO so (
         customer, start_date, end_date, amount, payment_terms, billing_address,
         customer_signature, burst, technical_account_manager, status, source_filename, processed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       RETURNING id`,
      [
        input.fields.customer ?? null,
        input.fields.startDate ?? null,
        input.fields.endDate ?? null,
        input.fields.amount ?? null,
        input.fields.paymentTerms ?? null,
        input.fields.billingAddress ?? null,
        input.fields.customerSignature ?? null,
        input.fields.burst ?? null,
        input.fields.technicalAccountManager ?? null,
        input.status,
        input.sourceFilename,
      ],
    )
    const soId = rows[0].id as number

    if (input.items.length > 0) {
      const columnsPerRow = 5
      const values: unknown[] = []
      const placeholders = input.items.map((item, i) => {
        const offset = i * columnsPerRow
        values.push(soId, item.productName, item.quantity, item.price, item.totalAmount)
        return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5})`
      })
      await client.query(
        `INSERT INTO so_items (so_id, product_name, quantity, price, total_amount)
         VALUES ${placeholders.join(',')}`,
        values,
      )
    }

    await client.query('COMMIT')
    client.release()
    return { id: soId }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // the original err is what matters; a failed rollback doesn't replace it
    }
    client.release(err instanceof Error ? err : new Error(String(err)))
    throw err
  }
}
