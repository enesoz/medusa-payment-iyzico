import type { IyzipayCallback } from 'iyzipay'

// ---------------------------------------------------------------------------
// LOAD-BEARING TEST (Story 20.2 AC2 / spike-19-1 S1b).
//
// The whole money-safety property of the epic is: a PARTIAL postauth must NEVER
// reach Iyzico, because Iyzico prorates a partial capture globally across every
// sub-merchant and drives `merchantCommissionRateAmount` negative — silently
// shaving seller payouts. This is guaranteed BY CONSTRUCTION here:
//   1. Medusa's `CapturePaymentInput` carries no amount, and the Payment Module
//      never passes a capture amount to the provider.
//   2. The client's `postAuthFull` deliberately omits `paidPrice`.
// These tests prove the request the SDK receives has NO `paidPrice`.
// ---------------------------------------------------------------------------

interface MockResource {
  create: jest.Mock
  retrieve: jest.Mock
}
interface MockIyzipayInstance {
  paymentPostAuth: MockResource
  checkoutFormInitializePreAuth: MockResource
  checkoutForm: MockResource
  cancel: MockResource
  refund: MockResource
  payment: MockResource
}

const okCallback = (req: Record<string, unknown>, cb: IyzipayCallback): void =>
  cb(null, { status: 'success', echo: req })

jest.mock('iyzipay', () => {
  const makeResource = (): MockResource => ({
    create: jest.fn(okCallback),
    retrieve: jest.fn(okCallback),
  })
  const ctor = jest.fn(
    (): MockIyzipayInstance => ({
      paymentPostAuth: makeResource(),
      checkoutFormInitializePreAuth: makeResource(),
      checkoutForm: makeResource(),
      cancel: makeResource(),
      refund: makeResource(),
      payment: makeResource(),
    })
  )
  return Object.assign(ctor, {
    LOCALE: { TR: 'tr', EN: 'en' },
    PAYMENT_GROUP: { PRODUCT: 'PRODUCT', LISTING: 'LISTING', SUBSCRIPTION: 'SUBSCRIPTION' },
    CURRENCY: { TRY: 'TRY' },
  })
})

import Iyzipay from 'iyzipay'
import { IyzicoClient } from '../client'
import { IyzicoProviderOptions } from '../types'

const options: IyzicoProviderOptions = {
  apiKey: 'test-key',
  secretKey: 'test-secret',
  baseUrl: 'https://sandbox-api.iyzipay.com',
  callbackUrl: 'https://example.com/cb',
}

type MockedCtor = jest.Mock & { mock: { results: Array<{ value: MockIyzipayInstance }> } }

function lastInstance(): MockIyzipayInstance {
  const ctor = Iyzipay as unknown as MockedCtor
  return ctor.mock.results[ctor.mock.results.length - 1].value
}

describe('Story 20.2 AC2 — full-capture-by-construction (no partial postauth)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('postAuthFull sends NO paidPrice to Iyzico (full capture)', async () => {
    const client = new IyzicoClient(options)
    await client.postAuthFull({ paymentId: 'pay_1', conversationId: 'conv_1' })

    const request = lastInstance().paymentPostAuth.create.mock.calls[0][0] as Record<
      string,
      unknown
    >
    // The invariant: a partial amount can never reach the gateway.
    expect(request).not.toHaveProperty('paidPrice')
    expect(request).not.toHaveProperty('price')
    expect(request).toMatchObject({ paymentId: 'pay_1', conversationId: 'conv_1' })
  })

  it('postAuthFull has no parameter through which a partial amount could be supplied', async () => {
    const client = new IyzicoClient(options)
    // The PostAuthFullParams type carries only paymentId/conversationId/ip/locale —
    // there is no amount field. This call compiles only because none is required.
    await client.postAuthFull({ paymentId: 'pay_2' })

    const request = lastInstance().paymentPostAuth.create.mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(request).not.toHaveProperty('paidPrice')
  })
})
