import { computeHmacSha256, normalizePrice, verifyCheckoutFormSignature } from '../signature'
import { IyzipayResult } from '../types'

describe('normalizePrice', () => {
  it.each([
    ['10.50', '10.5'],
    ['10.00', '10'],
    ['10.0', '10'],
    ['10', '10'],
    ['100', '100'],
    [10.5, '10.5'],
    [undefined, ''],
  ])('%p → %p', (input, expected) => {
    expect(normalizePrice(input)).toBe(expected)
  })
})

describe('verifyCheckoutFormSignature', () => {
  const secret = 'sandbox-secret'
  // Doc order with Iyzico's own trailing-zero normalization applied to the signed string.
  const signature = computeHmacSha256(
    ['SUCCESS', '38093815', 'TRY', 'B-1', '', '10.5', '10.5', 'tok'],
    secret
  )

  it('accepts "10.50" string prices and an absent conversationId', () => {
    expect(
      verifyCheckoutFormSignature(
        {
          status: 'success', paymentStatus: 'SUCCESS', paymentId: '38093815', currency: 'TRY', basketId: 'B-1',
          paidPrice: '10.50', price: '10.50', token: 'tok', signature,
        } as IyzipayResult,
        secret
      )
    ).toBe(true)
  })

  it('rejects a short non-hex signature without throwing', () => {
    expect(verifyCheckoutFormSignature({ status: 'success', signature: 'zz' } as IyzipayResult, secret)).toBe(false)
  })
})
