import type Iyzipay from 'iyzipay'

/** Re-export the SDK result type under a local name for the rest of the provider. */
export type IyzipayResult = Iyzipay.IyzipayResult

/**
 * Provider options passed in the host's `medusa-config.ts`. Validated by
 * `IyzicoProviderService.validateOptions` at boot (fail-fast).
 */
export interface IyzicoProviderOptions {
  /** Iyzico API key. */
  apiKey: string
  /** Iyzico secret key (also used to verify the 3DS callback signature). */
  secretKey: string
  /** Iyzico API base URL, e.g. `https://sandbox-api.iyzipay.com`. Maps to the SDK `uri`. */
  baseUrl: string
  /** 3DS / hosted-form callback URL the bank POSTs back to after the challenge. */
  callbackUrl: string
}

/**
 * Opaque, PSP-shaped request fragments assembled APP-SIDE (buyer, basket items
 * with `subMerchantKey` / `subMerchantPrice`, addresses) and handed to the
 * provider via the payment session `data`. The provider forwards these to Iyzico
 * untouched — it computes NO commission / split / sub-merchant logic (decision D10).
 */
export interface IyzicoInitiateRequestData {
  /** Iyzico `buyer` object (assembled app-side). */
  buyer?: Record<string, unknown>
  /** Iyzico `basketItems` (each may carry `subMerchantKey` + `subMerchantPrice`). */
  basketItems?: ReadonlyArray<Record<string, unknown>>
  /** Iyzico `shippingAddress` object. */
  shippingAddress?: Record<string, unknown>
  /** Iyzico `billingAddress` object. */
  billingAddress?: Record<string, unknown>
  /** Optional Iyzico `paymentGroup` override (defaults to PRODUCT). */
  paymentGroup?: string
  /** Optional 2-letter locale (`TR` | `EN`); defaults to TR. */
  locale?: string
}

/**
 * Data persisted on the Medusa PaymentSession / Payment `data` field across the
 * lifecycle. Keys are populated as the payment moves initiate → authorize → capture.
 */
export interface IyzicoPaymentData {
  /** Correlation id echoed to Iyzico — set to the Medusa payment_session id. */
  conversationId?: string
  /** CheckoutForm token returned by the preauth initialize call. */
  token?: string
  /** Iyzico `paymentId` (present once authorized). */
  paymentId?: string
  /** Iyzico `paymentTransactionId` per basket item — needed for refunds. */
  paymentTransactionId?: string
  /** ISO currency code captured at initiate time. */
  currency?: string
  /** Initiate-time request fragments (pass-through, see IyzicoInitiateRequestData). */
  request?: IyzicoInitiateRequestData
  /** Most recent raw Iyzico result, stored for reconciliation/debugging. */
  result?: IyzipayResult
}

/** Fields parsed from the synchronous 3DS callback POST. */
export interface IyzicoCallbackPayload {
  paymentId?: string
  conversationId?: string
  conversationData?: string
  mdStatus?: string
  status?: string
  signature?: string
  token?: string
}
