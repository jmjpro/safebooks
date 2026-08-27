import type { ExtractedItem } from '../../../src/extraction/field-extractor.js'

// Hand-verified expected extraction for sample-input/ACME Order From.pdf, shared between
// the DB-backed happy-path eval and the extraction-only model-comparison eval so the two
// suites can't silently disagree about what "correct" looks like for this document.
export const ACME_ORDER_FORM = {
  filename: 'ACME Order From.pdf',
  customer: 'Appsoft Inc.',
  startDate: '01-01-2025',
  endDate: '12-31-2026',
  amount: 152500,
  paymentTerms: 'Net 30',
  billingAddress: '123 Main Street, New York, NY, USA',
  customerSignature: true,
  burstPattern: /5%/,
  tamPattern: /Support Manager|Architect/,
  items: [
    { productName: 'SaaS Subscription', quantity: 1, price: 50000, totalAmount: 50000 },
    { productName: 'SaaS Subscription', quantity: 1, price: 60000, totalAmount: 60000 },
    { productName: 'Premium Support', quantity: 100, price: 250, totalAmount: 25000 },
    { productName: 'Premium Support', quantity: 50, price: 250, totalAmount: 12500 },
    { productName: 'Training Package', quantity: 50, price: 100, totalAmount: 5000 },
  ] satisfies ExtractedItem[],
}
