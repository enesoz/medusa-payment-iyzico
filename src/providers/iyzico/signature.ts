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

/**
 * Constant-time string comparison (defends against timing attacks on the signature).
 *
 * Compares the raw strings as UTF-8 bytes rather than decoding them as hex. A
 * `'hex'` decode is unsafe here: an attacker can POST a same-length but non-hex
 * `signature`, which `Buffer.from(x, 'hex')` truncates to a SHORTER buffer than the
 * 32-byte expected digest, so `timingSafeEqual` throws `RangeError` ("Input buffers
 * must have the same byte length") and crashes the 3DS callback route. The length
 * guard plus a UTF-8 compare is timing-safe and never throws. (Mirrors the
 * `constantTimeCompare` precedent that likewise omits `'hex'`.)
 *
 * Named `safeEqualString` (not `safeEqualHex`) to avoid the misleading implication
 * that hex decoding is performed — it is intentionally NOT decoded.
 */
export function safeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Verify the signature on a hosted CheckoutForm retrieve result. Iyzico signs the result over
 * `[paymentStatus, paymentId, currency, basketId, conversationId, paidPrice, price, token]`
 * with trailing zeros stripped from prices.
 *
 * [doc-verified 2026-10-02] docs.iyzico.com response-signature-validation ("Checkout Form —
 * Detail") and iyzipay `samples/IyzipaySamples.js:364` agree. Confirmed against a real SANDBOX
 * retrieve (paymentId 38093815): this list matched; the previous list without `paymentStatus`
 * did not. An absent `conversationId` (retrieve sent without one) is hashed as ''.
 */
export function verifyCheckoutFormSignature(result: IyzipayResult, secretKey: string): boolean {
  const provided = typeof result.signature === 'string' ? result.signature : ''
  if (!provided) {
    return false
  }
  const fields: ReadonlyArray<string> = [
    asField(result.paymentStatus),
    asField(result.paymentId),
    asField(result.currency),
    asField(result.basketId),
    asField(result.conversationId),
    normalizePrice(result.paidPrice),
    normalizePrice(result.price),
    asField(result.token),
  ]
  const expected = computeHmacSha256(fields, secretKey)
  return safeEqualString(provided, expected)
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
  return safeEqualString(provided, expected)
}

/** Coerce an unknown Iyzico result field to the string form used in signature input. */
function asField(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  return String(value)
}

/**
 * Iyzico strips trailing decimal zeros from prices before signing ("10.50" → "10.5",
 * "10.00" → "10"). String-only, so no float rounding can creep in.
 */
export function normalizePrice(value: unknown): string {
  const s = asField(value)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}
