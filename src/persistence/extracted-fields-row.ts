import type { ExtractedFields } from '../extraction/field-extractor.js'
import { mmDdYyyyToIso } from '../shared/date.js'

// so/po/unclassified_documents all share this same 9-column prefix (customer through
// technical_account_manager) — see ADR 0001 and ADR 0006 on why the tables are separate
// despite the shared shape. Centralized so a field addition/rename only needs to touch the
// column list, the value mapping, and the schema once, instead of three parallel copies
// that could drift out of sync.
export const EXTRACTED_FIELDS_COLUMNS =
  'customer, start_date, end_date, amount, payment_terms, billing_address, customer_signature, burst, technical_account_manager'

export function extractedFieldsValues(fields: Partial<ExtractedFields>): unknown[] {
  return [
    fields.customer ?? null,
    fields.startDate != null ? mmDdYyyyToIso(fields.startDate) : null,
    fields.endDate != null ? mmDdYyyyToIso(fields.endDate) : null,
    fields.amount ?? null,
    fields.paymentTerms ?? null,
    fields.billingAddress ?? null,
    fields.customerSignature ?? null,
    fields.burst ?? null,
    fields.technicalAccountManager ?? null,
  ]
}
