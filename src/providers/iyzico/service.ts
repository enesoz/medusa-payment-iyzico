import {
  AbstractPaymentProvider,
  BigNumber,
  MathBN,
  MedusaError,
  PaymentSessionStatus,
} from '@medusajs/framework/utils'
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from '@medusajs/framework/types'
import { IyzicoClient } from './client'
import {
  IyzicoCallbackPayload,
  IyzicoInitiateRequestData,
  IyzicoPaymentData,
  IyzicoProviderOptions,
  IyzipayResult,
} from './types'
import { verifyCheckoutFormSignature, verifyThreedsCallbackSignature } from './signature'

interface InjectedDependencies {
  logger: Logger
  // The Medusa module cradle carries other resolvable resources; the index signature is
  // REQUIRED by `AbstractPaymentProvider<TConfig>` — its constructor parameter is
  // `Record<string, unknown>`, so any concrete container type must also satisfy that
  // constraint. Removing it breaks assignability at the `super(container, options)` call.
  [key: string]: unknown
}

/**
 * Iyzico payment provider for MedusaJS v2 — generic preauth → authorize → capture →
 * refund / cancel lifecycle over the `iyzipay` SDK. Carries NO marketplace logic:
 * sub-merchant / commission split data rides through `initiatePayment`'s `data` as
 * opaque basket items and is forwarded untouched (decision D10).
 *
 * Capture is FULL-amount by construction — see `capturePayment` and the client's
 * `postAuthFull` (spike-19-1 S1b: a partial postauth prorates globally across
 * sub-merchants and shaves seller payouts).
 */
class IyzicoProviderService extends AbstractPaymentProvider<IyzicoProviderOptions> {
  static identifier = 'iyzico'

  protected readonly logger_: Logger
  protected readonly options_: IyzicoProviderOptions
  protected readonly client_: IyzicoClient

  static validateOptions(options: Record<string, unknown>): void {
    const required: ReadonlyArray<keyof IyzicoProviderOptions> = [
      'apiKey',
      'secretKey',
      'baseUrl',
      'callbackUrl',
    ]
    for (const key of required) {
      const value = options[key]
      if (typeof value !== 'string' || value.length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Iyzico provider option "${key}" is required and must be a non-empty string.`
        )
      }
    }
  }

  constructor(container: InjectedDependencies, options: IyzicoProviderOptions) {
    super(container, options)
    // Re-validate in the constructor INTENTIONALLY — this is belt-and-suspenders with
    // Medusa's boot-time static call to `validateOptions`. The static call runs at
    // plugin-load time to give operators a fast config error; the constructor call
    // guards against programmatic construction in tests (and any future code path that
    // bypasses the Medusa loader). This is NOT a Medusa framework gap — it is
    // deliberate fail-fast for both entry points.
    IyzicoProviderService.validateOptions({
      apiKey: options.apiKey,
      secretKey: options.secretKey,
      baseUrl: options.baseUrl,
      callbackUrl: options.callbackUrl,
    })
    this.logger_ = container.logger
    this.options_ = options
    this.client_ = new IyzicoClient(options, this.logger_)
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const pdata = parsePaymentData(input.data)
    const request: IyzicoInitiateRequestData = pdata.request ?? {}
    const price = amountToString(input.amount)
    const currency = input.currency_code.toUpperCase()

    const result = await this.client_.initializePreAuth({
      conversationId: pdata.conversationId ?? '',
      price,
      paidPrice: price,
      currency,
      callbackUrl: this.options_.callbackUrl,
      paymentGroup: request.paymentGroup,
      locale: request.locale,
      buyer: request.buyer,
      basketItems: request.basketItems,
      shippingAddress: request.shippingAddress,
      billingAddress: request.billingAddress,
    })

    const token = typeof result.token === 'string' ? result.token : undefined
    const nextData: IyzicoPaymentData = {
      conversationId: pdata.conversationId,
      token,
      currency,
      request,
      result,
    }
    return {
      id: token ?? pdata.conversationId ?? '',
      data: toRecord(nextData),
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.token) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Iyzico authorizePayment requires a CheckoutForm token in payment data.'
      )
    }

    const result = await this.client_.retrieveCheckoutForm({
      token: pdata.token,
      conversationId: pdata.conversationId,
    })

    if (!verifyCheckoutFormSignature(result, this.options_.secretKey)) {
      this.logger_.warn(
        `Iyzico CheckoutForm signature verification failed — possible tampered callback or wrong secretKey. conversationId=${pdata.conversationId ?? 'unknown'}`
      )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Iyzico CheckoutForm signature verification failed.'
      )
    }

    const status = mapIyzicoStatus(result, this.logger_)
    const transactionIds = extractPaymentTransactionIds(result)
    const nextData: IyzicoPaymentData = {
      ...pdata,
      paymentId: readString(result, 'paymentId') ?? pdata.paymentId,
      paymentTransactionId: transactionIds[0] ?? pdata.paymentTransactionId,
      paymentTransactionIds: transactionIds.length > 0 ? transactionIds : pdata.paymentTransactionIds,
      result,
    }
    return { status, data: toRecord(nextData) }
  }

  /**
   * FULL postauth only. The Medusa Payment Module never passes a capture amount to a
   * provider (`CapturePaymentInput` is `{ data, context }`; partial logic is handled at
   * the module level). Combined with the client's `postAuthFull` (no `paidPrice`), a
   * partial amount can NEVER reach Iyzico — the spike-S1b proration payout-shave is
   * unreachable by construction. DO NOT add a partial-capture branch here.
   */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.paymentId) {
      this.logger_.error(
        `Iyzico capturePayment called without a paymentId — payment may not have been authorized. conversationId=${pdata.conversationId ?? 'unknown'}`
      )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Iyzico capturePayment requires a paymentId in payment data.'
      )
    }
    const result = await this.client_.postAuthFull({
      paymentId: pdata.paymentId,
      conversationId: pdata.conversationId,
    })
    return { data: toRecord({ ...pdata, captureResult: serializeResult(result) }) }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.paymentId) {
      // Nothing was authorized at the gateway yet — nothing to void.
      return { data: input.data }
    }
    // ⚠ spike-19-1 Q5: sandbox settlement is mocked; cancel-void fidelity is verified
    // against PRODUCTION keys in Story 20.1 before this is trusted in a money path.
    const result = await this.client_.cancel({
      paymentId: pdata.paymentId,
      conversationId: pdata.conversationId,
    })
    return { data: toRecord({ ...pdata, cancelResult: serializeResult(result) }) }
  }

  /**
   * Iyzico has no API to delete an initiated (uncaptured, pre-authorize) CheckoutForm
   * session — the token simply expires. No-op: return the existing data unchanged.
   */
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.paymentTransactionId) {
      this.logger_.error(
        `Iyzico refundPayment called without a paymentTransactionId — payment may not have been authorized. paymentId=${pdata.paymentId ?? 'unknown'} conversationId=${pdata.conversationId ?? 'unknown'}`
      )
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Iyzico refundPayment requires a paymentTransactionId in payment data.'
      )
    }
    const result = await this.client_.refund({
      paymentTransactionId: pdata.paymentTransactionId,
      price: amountToString(input.amount),
      currency: pdata.currency,
      conversationId: pdata.conversationId,
    })
    return { data: toRecord({ ...pdata, refundResult: serializeResult(result) }) }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.paymentId) {
      return { status: PaymentSessionStatus.PENDING }
    }
    const result = await this.client_.retrievePayment({
      paymentId: pdata.paymentId,
      conversationId: pdata.conversationId,
    })
    return { status: mapIyzicoStatus(result, this.logger_), data: toRecord({ ...pdata, result }) }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const pdata = parsePaymentData(input.data)
    if (!pdata.paymentId) {
      return { data: input.data }
    }
    const result = await this.client_.retrievePayment({
      paymentId: pdata.paymentId,
      conversationId: pdata.conversationId,
    })
    return { data: toRecord({ ...pdata, result }) }
  }

  /**
   * Iyzico has no API to mutate an already-initiated CheckoutForm session (price/buyer
   * are fixed at creation). An amount change is handled by re-initiating a new session
   * upstream. No-op here: return the existing data unchanged.
   */
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: input.data }
  }

  /**
   * Handles the SYNCHRONOUS 3DS callback POST only (`paymentId` / `mdStatus` /
   * `signature`). Iyzico emits NO async settlement / expiry / cancel webhooks for these
   * flows (spike-19-1 Q3/Q5) — never branch on a push-settlement event here.
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload['payload']
  ): Promise<WebhookActionResult> {
    const callback = parseCallback(payload.data)
    const sessionId = callback.conversationId ?? ''
    const amount = readCallbackAmount(payload.data)

    const signatureValid = verifyThreedsCallbackSignature(callback, this.options_.secretKey)
    // Coerce mdStatus (form-POST fields are strings, but a numeric `1` must not slip past)
    // and gate POSITIVELY on `status === 'success'` so an absent/unknown status fails closed.
    const authorized =
      signatureValid && String(callback.mdStatus) === '1' && callback.status === 'success'

    if (!authorized) {
      return { action: 'failed', data: { session_id: sessionId, amount } }
    }
    return { action: 'authorized', data: { session_id: sessionId, amount } }
  }
}

export default IyzicoProviderService

// ---------------------------------------------------------------------------
// Pure helpers (type-safe parsing of the opaque `data` records — no `any`).
// ---------------------------------------------------------------------------

function amountToString(amount: BigNumberInput): string {
  return MathBN.convert(amount).toString()
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

function parsePaymentData(data: Record<string, unknown> | undefined): IyzicoPaymentData {
  if (!data) {
    return {}
  }
  const request = data['request']
  const transactionIds = data['paymentTransactionIds']
  return {
    conversationId: readString(data, 'conversationId'),
    token: readString(data, 'token'),
    paymentId: readString(data, 'paymentId'),
    paymentTransactionId: readString(data, 'paymentTransactionId'),
    paymentTransactionIds: Array.isArray(transactionIds)
      ? transactionIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    currency: readString(data, 'currency'),
    request: isRecord(request) ? toInitiateRequestData(request) : undefined,
    result: isRecord(data['result']) ? (data['result'] as IyzipayResult) : undefined,
    captureResult: isRecord(data['captureResult']) ? (data['captureResult'] as IyzipayResult) : undefined,
    cancelResult: isRecord(data['cancelResult']) ? (data['cancelResult'] as IyzipayResult) : undefined,
    refundResult: isRecord(data['refundResult']) ? (data['refundResult'] as IyzipayResult) : undefined,
  }
}

function parseCallback(data: Record<string, unknown>): IyzicoCallbackPayload {
  return {
    paymentId: readString(data, 'paymentId'),
    conversationId: readString(data, 'conversationId'),
    conversationData: readString(data, 'conversationData'),
    mdStatus: readString(data, 'mdStatus'),
    status: readString(data, 'status'),
    signature: readString(data, 'signature'),
    token: readString(data, 'token'),
  }
}

/** Best-effort read of an amount from the callback body for the webhook result. */
function readCallbackAmount(data: Record<string, unknown>): BigNumber {
  const raw = readString(data, 'paidPrice') ?? readString(data, 'price') ?? '0'
  return new BigNumber(raw)
}

/**
 * Extract EVERY item transaction id from an Iyzico result. A multi-sub-merchant basket
 * has one `paymentTransactionId` per seller and refunds are per-transaction, so all ids
 * are returned (order preserved) — never just the first.
 */
function extractPaymentTransactionIds(result: IyzipayResult): string[] {
  const transactions = result['itemTransactions']
  if (!Array.isArray(transactions)) {
    return []
  }
  const ids: string[] = []
  for (const tx of transactions) {
    if (isRecord(tx)) {
      const id = readString(tx, 'paymentTransactionId')
      if (id) {
        ids.push(id)
      }
    }
  }
  return ids
}

/** Map an Iyzico payment result to a Medusa PaymentSessionStatus. */
function mapIyzicoStatus(result: IyzipayResult, logger?: Logger): PaymentSessionStatus {
  const paymentStatus = readString(result, 'paymentStatus')
  const phase = readString(result, 'phase')

  if (paymentStatus === 'FAILURE') {
    return PaymentSessionStatus.ERROR
  }
  if (paymentStatus === 'SUCCESS') {
    if (phase === 'PRE_AUTH') {
      return PaymentSessionStatus.AUTHORIZED
    }
    if (phase === 'POST_AUTH' || phase === 'AUTH' || phase === 'PAID_PRE_AUTH') {
      return PaymentSessionStatus.CAPTURED
    }
    // SUCCESS with an unrecognised or absent phase — Iyzico may introduce new phases;
    // fall back to AUTHORIZED (the preauth state) so the payment is not silently lost.
    // This is a forward-compatibility fallthrough; log it so new phases are surfaced.
    logger?.warn(
      `Iyzico mapIyzicoStatus: SUCCESS with unrecognised phase "${phase ?? 'undefined'}" — defaulting to AUTHORIZED.`
    )
    return PaymentSessionStatus.AUTHORIZED
  }
  if (paymentStatus === 'INIT_THREEDS' || paymentStatus === 'CALLBACK_THREEDS') {
    return PaymentSessionStatus.REQUIRES_MORE
  }
  return PaymentSessionStatus.PENDING
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Coerce a plain record to `IyzicoInitiateRequestData` by reading only known keys
 * (mirrors the `parsePaymentData` pattern — no bare `as` cast).
 */
function toInitiateRequestData(obj: Record<string, unknown>): IyzicoInitiateRequestData {
  const buyer = obj['buyer']
  const basketItems = obj['basketItems']
  const shippingAddress = obj['shippingAddress']
  const billingAddress = obj['billingAddress']
  return {
    buyer: isRecord(buyer) ? buyer : undefined,
    basketItems: Array.isArray(basketItems)
      ? basketItems.filter(isRecord)
      : undefined,
    shippingAddress: isRecord(shippingAddress) ? shippingAddress : undefined,
    billingAddress: isRecord(billingAddress) ? billingAddress : undefined,
    paymentGroup: readString(obj, 'paymentGroup'),
    locale: readString(obj, 'locale'),
  }
}

/**
 * Strip non-serializable values from a raw `IyzipayResult` before storing it on the
 * payment data record. `JSON.parse(JSON.stringify(...))` removes functions, `undefined`
 * values, and circular references that cannot be persisted by Medusa's data layer.
 */
function serializeResult(result: IyzipayResult): IyzipayResult {
  return JSON.parse(JSON.stringify(result)) as IyzipayResult
}

/** Serialize a typed payment-data object back to the `Record<string, unknown>` Medusa stores. */
function toRecord(data: object): Record<string, unknown> {
  const entries = Object.entries(data) as ReadonlyArray<[string, unknown]>
  const out: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}
