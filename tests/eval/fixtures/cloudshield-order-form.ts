import type { ExtractedItem } from '../../../src/extraction/field-extractor.js'

// Hand-verified expected extraction for sample-input/CloudShield Order Form.pdf, shared between
// the DB-backed happy-path evals and the extraction-only model-comparison eval so the suites
// can't silently disagree about what "correct" looks like for this document.
export const CLOUDSHIELD_ORDER_FORM = {
  filename: 'CloudShield Order Form.pdf',
  customer: 'TechNova Solutions, Inc.',
  startDate: '03-01-2025',
  endDate: '02-28-2028',
  amount: 23640000,
  paymentTerms: 'Net 45',
  billingAddress: '2500 Tech Park Boulevard, Austin, Texas 78701',
  customerSignature: false,
  burstPattern: /38\.89%/,
  // Special Terms list no dedicated point-of-contact term — tamPattern is null, testing
  // that the model correctly returns null rather than hallucinating one from the "Premium
  // Support" line item (which is a paid product, not a TAM assignment).
  tamPattern: null as RegExp | null,
  // price uses the document's literal "Monthly / Unit Price" column (rounded to 2dp per the
  // document's own disclaimer), not a derived annual rate — this matches what every model
  // actually reads off the table's labeled column.
  items: [
    { productName: 'CloudShield Enterprise', quantity: 180000, price: 3.25, totalAmount: 7020000 },
    { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
    { productName: 'CloudShield Enterprise', quantity: 195000, price: 3.25, totalAmount: 7605000 },
    { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
    { productName: 'CloudShield Enterprise', quantity: 210000, price: 3.25, totalAmount: 8190000 },
    { productName: 'Premium Support', quantity: 1, price: 22916.67, totalAmount: 275000 },
  ] satisfies ExtractedItem[],
}
