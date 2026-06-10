import { createHmac, timingSafeEqual } from 'crypto'
import { IyzicoCallbackPayload, IyzipayResult } from './types'

/**
 * Compute Iyzico's v2 HMAC-SHA256 signature over a colon-joined field list — mirrors
 * the SDK's internal `utils.calculateHmacSHA256Signature` (lib/utils.js) without
 * importing an unpublished internal path.
 */
export function computeHmacSha256(params: ReadonlyArray<string>, secretKey: string): string {
  return createHmac('sha256', secretKey).update(params.join(':')).digest('hex')
}

/** Constant-time hex-string comparison (defends against timing attacks on the signature). */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * Verify the signature on a hosted CheckoutForm retrieve result. Iyzico signs the
 * result over `[paymentId, currency, basketId, conversationId, paidPrice, price, token]`.
 *
 * ⚠ Story 20.1 GATE: the exact field ordering is confirmed against PRODUCTION keys
 * (the spike's sandbox callback round-trip was not exercised — `mock*iyzihostrfn`
 * settlement). Until 20.1's memo lands, treat a verification pass as structurally
 * correct but not production-proven.
 */
export function verifyCheckoutFormSignature(result: IyzipayResult, secretKey: string): boolean {
  const provided = typeof result.signature === 'string' ? result.signature : ''
  if (!provided) {
    return false
  }
  const fields: ReadonlyArray<string> = [
    asField(result.paymentId),
    asField(result.currency),
    asField(result.basketId),
    asField(result.conversationId),
    asField(result.paidPrice),
    asField(result.price),
    asField(result.token),
  ]
  const expected = computeHmacSha256(fields, secretKey)
  return safeEqualHex(provided, expected)
}

/**
 * Verify the signature on a raw 3DS callback POST. Iyzico signs the callback over
 * `[conversationData, conversationId, mdStatus, paymentId, status]`.
 *
 * ⚠ Same Story 20.1 production-confirmation caveat as above.
 */
export function verifyThreedsCallbackSignature(
  payload: IyzicoCallbackPayload,
  secretKey: string
): boolean {
  const provided = typeof payload.signature === 'string' ? payload.signature : ''
  if (!provided) {
    return false
  }
  const fields: ReadonlyArray<string> = [
    payload.conversationData ?? '',
    payload.conversationId ?? '',
    payload.mdStatus ?? '',
    payload.paymentId ?? '',
    payload.status ?? '',
  ]
  const expected = computeHmacSha256(fields, secretKey)
  return safeEqualHex(provided, expected)
}

/** Coerce an unknown Iyzico result field to the string form used in signature input. */
function asField(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}
