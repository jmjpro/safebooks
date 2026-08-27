import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { isValidMmDdYyyyDate } from '../shared/date.js'
import type {
  Document,
  ExtractedFields,
  FieldExtractionResult,
  FieldExtractor,
  FieldName,
} from './field-extractor.js'

const NET_TERMS = /^Net \d+$/

const extractionResponseSchema = z.object({
  documentType: z.enum(['OrderForm', 'PurchaseOrder', 'Unclassified']),
  customer: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  amount: z.number().nullable(),
  paymentTerms: z.string().nullable(),
  billingAddress: z.string().nullable(),
  customerSignature: z.boolean().nullable(),
  burst: z.string().nullable(),
  technicalAccountManager: z.string().nullable(),
  items: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number(),
      price: z.number(),
      totalAmount: z.number(),
    }),
  ),
})

const SYSTEM_PROMPT = `You are extracting structured data from a business Document (an Order Form or a Purchase Order PDF).

Classify the Document Type as exactly one of "OrderForm", "PurchaseOrder", or "Unclassified" (only if the document is neither of the other two), based on the document's content, not its filename.

Then extract these fields:
- customer: the counterparty named in the document's billing fields (look for labels like "Bill To", "Buyer", or "Customer Billing Company Name") — the company/party being billed, not the vendor issuing the document. Use the company name, not an address.
- startDate / endDate: the contract term's start and end dates, formatted exactly as "mm-dd-yyyy" (e.g. "01-01-2025"). Use the contract term dates, not the quote/document issue date.
- amount: the document's total contract amount as a plain number, with no currency symbols or commas.
- paymentTerms: formatted exactly as "Net xx" (e.g. "Net 30"), derived from the payment terms language (e.g. "payment due within thirty (30) days of invoice" -> "Net 30").
- billingAddress: the free-text billing/mailing address.
- customerSignature: true if the customer's signature block is filled in (a name is present on the customer's signature line, even if typed rather than hand-drawn), false if the signature block is blank or absent.
- burst: the Special Term describing the customer's right to exceed contracted usage by a set percentage at no additional cost (sometimes called a "Burst Threshold"). Extract the full text of this term verbatim. If the document has no such term, use null.
- technicalAccountManager: the Special Term describing a dedicated account/support contact assigned for the contract term. This is frequently phrased differently per customer (e.g. "Technical Account Manager", "Customer Support Manager", "Product Architect") — treat any dedicated point-of-contact assignment as this field. Extract the full text of this term verbatim. If the document has no such term, use null.
- items: every line item in the document's items table, each with productName, quantity, price (the unit rate), and totalAmount.

If a field's value truly cannot be found anywhere in the document, set it to null rather than guessing.`

// Used both when the API call itself throws (network/rate-limit/5xx) and when it resolves
// but returns unparsable output — in both cases we have zero signal on every field, so all
// of them, including the two optional Special Terms fields, are flagged as failed.
//
// documentType is 'ExtractionFailed', not 'Unclassified': we never got a usable read on this
// document, so we can't say it's genuinely out-of-scope — that's a distinct outcome from the
// LLM looking at the document and determining it's neither an Order Form nor a Purchase
// Order. See issue 08 (.scratch/document-extraction-pipeline/issues).
function totallyFailedResult(reason: string): FieldExtractionResult {
  return {
    documentType: 'ExtractionFailed',
    fields: {},
    items: [],
    fieldErrors: {
      customer: reason,
      startDate: reason,
      endDate: reason,
      amount: reason,
      paymentTerms: reason,
      billingAddress: reason,
      customerSignature: reason,
      burst: reason,
      technicalAccountManager: reason,
    },
  }
}

function assign<K extends FieldName>(
  fields: Partial<ExtractedFields>,
  fieldErrors: Partial<Record<FieldName, string>>,
  name: K,
  value: ExtractedFields[K] | null,
  invalidReason: string | null = null,
): void {
  if (value === null) {
    fieldErrors[name] = 'not found in document'
  } else if (invalidReason) {
    fieldErrors[name] = invalidReason
  } else {
    fields[name] = value
  }
}

type OptionalFieldName = 'burst' | 'technicalAccountManager'

// Burst and Technical Account Manager are Special Terms that only appear in a document's
// Special Terms section when the contract actually grants them — unlike the other fields,
// a document legitimately has neither. Treat null (or a blank string, which some models
// emit instead of null despite the prompt) here as "not applicable", not a failure: no
// fieldErrors entry, so a missing Special Terms section doesn't push the record to
// needs_review. Restricted to the two Special Terms fields — this must never be used for
// a required Structured Field, where an absent value should still block "processed" status.
// See issue 03 (.scratch/document-extraction-pipeline/issues).
function assignOptional<K extends OptionalFieldName>(
  fields: Partial<ExtractedFields>,
  name: K,
  value: string | null,
): void {
  if (value !== null && value.trim() !== '') {
    fields[name] = value
  }
}

// See issue 01.5 (.scratch/document-extraction-pipeline/issues) for the model comparison
// that settled on Haiku 4.5: it tied Opus 5 for field-level accuracy on the sample set
// while being faster and ~5x cheaper.
export const DEFAULT_MODEL = 'claude-haiku-4-5'

export class AnthropicFieldExtractor implements FieldExtractor {
  private readonly model: string

  constructor(
    private readonly client: Anthropic,
    model: string = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
  ) {
    this.model = model
  }

  async extract(document: Document): Promise<FieldExtractionResult> {
    let response
    try {
      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: document.content.toString('base64'),
                },
              },
              {
                type: 'text',
                text: `Extract the fields from this document (filename: ${document.filename}).`,
              },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(extractionResponseSchema) },
      })
    } catch (err) {
      // The FieldExtractor port's contract is "always resolves with a result, never throws"
      // — extractWithRetries (src/pipeline/retry-extraction.ts) relies on that to retry a
      // failed field without special-casing exceptions. A transient API error (rate limit,
      // 5xx, network blip) is therefore reported the same way as an unparsable response
      // below, not thrown.
      return totallyFailedResult(err instanceof Error ? err.message : String(err))
    }

    const parsed = response.parsed_output
    if (!parsed) {
      // Unlike a successful call reporting burst/technicalAccountManager as null (a confirmed
      // "no Special Terms section", not a failure — see assignOptional below), a totally
      // unparsable response means we have no signal on those fields at all. That's failure,
      // not confirmed absence, so every field — including the two optional ones — is flagged.
      return totallyFailedResult('extraction did not return parsable output')
    }

    const fields: Partial<ExtractedFields> = {}
    const fieldErrors: Partial<Record<FieldName, string>> = {}

    assign(fields, fieldErrors, 'customer', parsed.customer)
    assign(
      fields,
      fieldErrors,
      'startDate',
      parsed.startDate,
      parsed.startDate !== null && !isValidMmDdYyyyDate(parsed.startDate)
        ? `"${parsed.startDate}" is not a valid mm-dd-yyyy calendar date`
        : null,
    )
    assign(
      fields,
      fieldErrors,
      'endDate',
      parsed.endDate,
      parsed.endDate !== null && !isValidMmDdYyyyDate(parsed.endDate)
        ? `"${parsed.endDate}" is not a valid mm-dd-yyyy calendar date`
        : null,
    )
    assign(
      fields,
      fieldErrors,
      'amount',
      parsed.amount,
      parsed.amount !== null && !Number.isFinite(parsed.amount) ? 'amount is not numeric' : null,
    )
    assign(
      fields,
      fieldErrors,
      'paymentTerms',
      parsed.paymentTerms,
      parsed.paymentTerms !== null && !NET_TERMS.test(parsed.paymentTerms)
        ? `"${parsed.paymentTerms}" does not match "Net xx"`
        : null,
    )
    assign(fields, fieldErrors, 'billingAddress', parsed.billingAddress)
    assign(fields, fieldErrors, 'customerSignature', parsed.customerSignature)
    assignOptional(fields, 'burst', parsed.burst)
    assignOptional(fields, 'technicalAccountManager', parsed.technicalAccountManager)

    return {
      documentType: parsed.documentType,
      fields,
      items: parsed.items,
      fieldErrors,
    }
  }
}
