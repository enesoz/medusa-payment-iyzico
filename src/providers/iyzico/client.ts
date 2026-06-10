import Iyzipay from 'iyzipay'
import { MedusaError } from '@medusajs/framework/utils'
import { IyzicoProviderOptions, IyzipayResult } from './types'

/** Parameters for a hosted-form preauth (authorize-only) initialization. */
export interface InitializePreAuthParams {
  conversationId: string
  price: string
  paidPrice: string
  currency: string
  callbackUrl: string
  basketId?: string
  paymentGroup?: string
  locale?: string
  buyer?: Record<string, unknown>
  basketItems?: ReadonlyArray<Record<string, unknown>>
  shippingAddress?: Record<string, unknown>
  billingAddress?: Record<string, unknown>
}

/** Parameters to retrieve a hosted-form result after the 3DS callback. */
export interface RetrieveCheckoutFormParams {
  token: string
  conversationId?: string
  locale?: string
}

/** Parameters for a FULL postauth capture. Note: NO `paidPrice` — see AC2 invariant. */
export interface PostAuthFullParams {
  paymentId: string
  conversationId?: string
  ip?: string
  locale?: string
}

/** Parameters to cancel (void) an uncaptured preauth. */
export interface CancelParams {
  paymentId: string
  conversationId?: string
  ip?: string
  reason?: string
  description?: string
  locale?: string
}

/** Parameters for a refund of a captured payment (amount-bearing). */
export interface RefundParams {
  paymentTransactionId: string
  price: string
  currency?: string
  conversationId?: string
  ip?: string
  reason?: string
  description?: string
  locale?: string
}

/** Parameters to retrieve ground-truth payment data from Iyzico. */
export interface RetrievePaymentParams {
  paymentId: string
  conversationId?: string
  locale?: string
}

type ResourceCall = (callback: (err: Error | null, result: IyzipayResult) => void) => void

/**
 * Thin, generic transport over the `iyzipay` SDK. Confines all SDK usage and the
 * callback→Promise bridge. Carries NO marketplace logic — basket items (which may
 * include `subMerchantKey` / `subMerchantPrice`) are forwarded opaquely (decision D10).
 */
export class IyzicoClient {
  private readonly client_: Iyzipay
  private readonly callbackUrl_: string

  constructor(options: IyzicoProviderOptions) {
    this.client_ = new Iyzipay({
      apiKey: options.apiKey,
      secretKey: options.secretKey,
      uri: options.baseUrl,
    })
    this.callbackUrl_ = options.callbackUrl
  }

  /** Bridge a callback-style resource call to a Promise, failing loud on gateway errors. */
  private run_(operation: string, call: ResourceCall): Promise<IyzipayResult> {
    return new Promise<IyzipayResult>((resolve, reject) => {
      call((err, result) => {
        if (err) {
          reject(
            new MedusaError(
              MedusaError.Types.UNEXPECTED_STATE,
              `Iyzico ${operation} transport error: ${err.message}`
            )
          )
          return
        }
        if (!result || result.status !== 'success') {
          reject(
            new MedusaError(
              MedusaError.Types.INVALID_DATA,
              `Iyzico ${operation} failed (${result?.errorCode ?? 'unknown'}): ${
                result?.errorMessage ?? 'no error message'
              }`
            )
          )
          return
        }
        resolve(result)
      })
    })
  }

  initializePreAuth(params: InitializePreAuthParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      price: params.price,
      paidPrice: params.paidPrice,
      currency: params.currency,
      basketId: params.basketId,
      paymentGroup: params.paymentGroup ?? Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl: params.callbackUrl ?? this.callbackUrl_,
      buyer: params.buyer,
      shippingAddress: params.shippingAddress,
      billingAddress: params.billingAddress,
      basketItems: params.basketItems,
    }
    return this.run_('checkoutFormInitializePreAuth', (cb) =>
      this.client_.checkoutFormInitializePreAuth.create(request, cb)
    )
  }

  retrieveCheckoutForm(params: RetrieveCheckoutFormParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      token: params.token,
    }
    return this.run_('checkoutForm.retrieve', (cb) =>
      this.client_.checkoutForm.retrieve(request, cb)
    )
  }

  /**
   * FULL postauth capture. We deliberately OMIT `paidPrice` so Iyzico captures the
   * entire preauthorized amount. A partial `paidPrice` would prorate globally across
   * every sub-merchant and drive `merchantCommissionRateAmount` negative — silently
   * shaving seller payouts (spike-19-1 S1b). DO NOT add a `paidPrice` here. Partial /
   * per-item adjustments belong on the refund machinery, never on capture.
   */
  postAuthFull(params: PostAuthFullParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      paymentId: params.paymentId,
      ip: params.ip,
      // paidPrice: INTENTIONALLY ABSENT — full-capture-by-construction (AC2 / spike S1b).
    }
    return this.run_('paymentPostAuth', (cb) =>
      this.client_.paymentPostAuth.create(request, cb)
    )
  }

  cancel(params: CancelParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      paymentId: params.paymentId,
      ip: params.ip,
      reason: params.reason,
      description: params.description,
    }
    return this.run_('cancel', (cb) => this.client_.cancel.create(request, cb))
  }

  refund(params: RefundParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      paymentTransactionId: params.paymentTransactionId,
      price: params.price,
      currency: params.currency,
      ip: params.ip,
      reason: params.reason,
      description: params.description,
    }
    return this.run_('refund', (cb) => this.client_.refund.create(request, cb))
  }

  retrievePayment(params: RetrievePaymentParams): Promise<IyzipayResult> {
    const request: Record<string, unknown> = {
      locale: params.locale ?? Iyzipay.LOCALE.TR,
      conversationId: params.conversationId,
      paymentId: params.paymentId,
    }
    return this.run_('payment.retrieve', (cb) =>
      this.client_.payment.retrieve(request, cb)
    )
  }
}
