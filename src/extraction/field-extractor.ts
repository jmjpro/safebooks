export type DocumentType = 'OrderForm' | 'PurchaseOrder' | 'Unclassified'

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
