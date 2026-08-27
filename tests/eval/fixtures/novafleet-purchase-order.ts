import type { ExtractedItem } from '../../../src/extraction/field-extractor.js'

// Hand-verified expected extraction for sample-input/Purchase Order – NovaFleet Technologies Inc.pdf,
// shared between the DB-backed happy-path eval and the extraction-only model-comparison eval so
// the two suites can't silently disagree about what "correct" looks like for this document.
export const NOVAFLEET_PURCHASE_ORDER = {
  filename: 'Purchase Order – NovaFleet Technologies Inc.pdf',
  customer: 'NovaFleet Technologies Inc.',
  startDate: '02-01-2025',
  endDate: '01-31-2028',
  amount: 451000,
  paymentTerms: 'Net 45',
  billingAddress: '900 Enterprise Drive, Toronto, ON M5G 2C3, Canada',
  customerSignature: true,
  burstPattern: /15%/,
  tamPattern: /Technical Account Manager/,
  items: [
    { productName: 'Cloud Security Suite', quantity: 1, price: 120000, totalAmount: 120000 },
    { productName: 'Cloud Security Suite', quantity: 1, price: 132000, totalAmount: 132000 },
    { productName: 'Cloud Security Suite', quantity: 1, price: 145000, totalAmount: 145000 },
    { productName: 'Advanced Threat Monitoring', quantity: 3, price: 18000, totalAmount: 54000 },
  ] satisfies ExtractedItem[],
}
