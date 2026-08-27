import type { ExtractedItem } from '../../../src/extraction/field-extractor.js'

// Hand-verified expected extraction for sample-input/Purchase Order – BrightOps Analytics Ltd.pdf,
// shared between the DB-backed happy-path eval and the extraction-only model-comparison eval so
// the two suites can't silently disagree about what "correct" looks like for this document.
export const BRIGHTOPS_PURCHASE_ORDER = {
  filename: 'Purchase Order – BrightOps Analytics Ltd.pdf',
  customer: 'BrightOps Analytics Ltd.',
  startDate: '03-01-2025',
  endDate: '02-28-2027',
  amount: 162000,
  paymentTerms: 'Net 30',
  billingAddress: '42 King George Street, London, UK',
  customerSignature: true,
  burstPattern: /10%/,
  tamPattern: /Technical Account Manager/,
  items: [
    {
      productName: 'Analytics Platform – Enterprise',
      quantity: 1,
      price: 72000,
      totalAmount: 72000,
    },
    {
      productName: 'Analytics Platform – Enterprise',
      quantity: 1,
      price: 78000,
      totalAmount: 78000,
    },
    { productName: 'Premium Support', quantity: 1, price: 6000, totalAmount: 6000 },
    { productName: 'Premium Support', quantity: 1, price: 6000, totalAmount: 6000 },
  ] satisfies ExtractedItem[],
}
