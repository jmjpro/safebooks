import type { DocumentType, ExtractedItem } from '../../src/extraction/field-extractor.js'
import { ACME_ORDER_FORM } from './fixtures/acme-order-form.js'
import { BRIGHTOPS_PURCHASE_ORDER } from './fixtures/brightops-purchase-order.js'
import { CLOUDSHIELD_ORDER_FORM } from './fixtures/cloudshield-order-form.js'
import { NOVAFLEET_PURCHASE_ORDER } from './fixtures/novafleet-purchase-order.js'

export interface ExpectedDocument {
  filename: string
  documentType: DocumentType
  customer: string
  startDate: string
  endDate: string
  amount: number
  paymentTerms: string
  billingAddress: string
  customerSignature: boolean
  burstPattern: RegExp
  tamPattern: RegExp | null
  items: ExtractedItem[]
}

// The single hand-verified source of truth for what "correct" looks like across all 4
// sample documents (2 Order Form customers, 2 Purchase Order customers) — shared by the
// extraction-only model-comparison eval and the DB-backed end-to-end accuracy eval.
export const EXPECTED_DOCUMENTS: ExpectedDocument[] = [
  { documentType: 'OrderForm', ...ACME_ORDER_FORM },
  { documentType: 'OrderForm', ...CLOUDSHIELD_ORDER_FORM },
  { documentType: 'PurchaseOrder', ...BRIGHTOPS_PURCHASE_ORDER },
  { documentType: 'PurchaseOrder', ...NOVAFLEET_PURCHASE_ORDER },
]
