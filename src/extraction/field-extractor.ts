// 'ExtractionFailed' is a pipeline-internal sentinel, never a value the LLM itself returns
// (its response schema only allows the other three) — it marks a document where every retry
// attempt errored or produced unparsable output, so the extractor never got a real read on
// the document at all. Kept distinct from 'Unclassified' (the LLM looked at the document and
// determined it's neither an Order Form nor a Purchase Order) so the two aren't conflated once
// persisted. See issue 08 (.scratch/document-extraction-pipeline/issues).
export type DocumentType = 'OrderForm' | 'PurchaseOrder' | 'Unclassified' | 'ExtractionFailed'

export interface ExtractedItem {
  productName: string
  quantity: number
  price: number
  totalAmount: number
}

export interface ExtractedFields {
  customer: string
  startDate: string
  endDate: string
  amount: number
  paymentTerms: string
  billingAddress: string
  customerSignature: boolean
  burst: string
  technicalAccountManager: string
}

export type FieldName = keyof ExtractedFields

export interface FieldExtractionResult {
  documentType: DocumentType
  fields: Partial<ExtractedFields>
  items: ExtractedItem[]
  fieldErrors: Partial<Record<FieldName, string>>
}

export interface Document {
  filename: string
  content: Buffer
}

export interface FieldExtractor {
  extract(document: Document): Promise<FieldExtractionResult>
}
