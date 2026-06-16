jest.mock('../client')

import type { Logger } from '@medusajs/framework/types'
import { PaymentSessionStatus } from '@medusajs/framework/utils'
import IyzicoProviderService from '../service'
import { IyzicoClient } from '../client'
import { IyzicoProviderOptions, IyzipayResult } from '../types'
import { computeHmacSha256 } from '../signature'

const MockedClient = IyzicoClient as jest.MockedClass<typeof IyzicoClient>

const options: IyzicoProviderOptions = {
  apiKey: 'test-key',
  secretKey: 'test-secret',
  baseUrl: 'https://sandbox-api.iyzipay.com',
  callbackUrl: 'https://example.com/cb',
}

interface ClientMethods {
  initializePreAuth: jest.Mock
  retrieveCheckoutForm: jest.Mock
  postAuthFull: jest.Mock
  cancel: jest.Mock
  refund: jest.Mock
  retrievePayment: jest.Mock
}

let client: ClientMethods
let logger: Logger

function makeService(): IyzicoProviderService {
  return new IyzicoProviderService({ logger }, options)
}

beforeEach(() => {
  jest.clearAllMocks()
  client = {
    initializePreAuth: jest.fn(),
    retrieveCheckoutForm: jest.fn(),
    postAuthFull: jest.fn(),
    cancel: jest.fn(),
    refund: jest.fn(),
    retrievePayment: jest.fn(),
  }
  MockedClient.mockImplementation(() => client as unknown as IyzicoClient)
  logger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger
})

describe('IyzicoProviderService.validateOptions', () => {
  it('throws when a required option is missing', () => {
    expect(() =>
      IyzicoProviderService.validateOptions({ apiKey: 'a', secretKey: 'b', baseUrl: 'c' })
    ).toThrow(/callbackUrl/)
  })

  it('passes with all required options', () => {
    expect(() =>
      IyzicoProviderService.validateOptions({ ...options })
    ).not.toThrow()
  })

  it('exposes the provider identifier', () => {
    expect(IyzicoProviderService.identifier).toBe('iyzico')
  })
})

describe('initiatePayment', () => {
  it('opens a preauth session and returns the token as id', async () => {
    client.initializePreAuth.mockResolvedValue({ status: 'success', token: 'tok_1' })
    const service = makeService()

    const result = await service.initiatePayment({
      amount: 300,
      currency_code: 'try',
      data: { conversationId: 'conv_1' },
    })

    expect(client.initializePreAuth).toHaveBeenCalledWith(
      expect.objectContaining({ price: '300', paidPrice: '300', currency: 'TRY' })
    )
    expect(result.id).toBe('tok_1')
    expect(result.data).toMatchObject({ token: 'tok_1', currency: 'TRY' })
  })

  it('forwards request.basketId to Iyzico so the cart id round-trips back on callback', async () => {
    client.initializePreAuth.mockResolvedValue({ status: 'success', token: 'tok_2' })
    const service = makeService()

    await service.initiatePayment({
      amount: 300,
      currency_code: 'try',
      data: { conversationId: 'conv_1', request: { basketId: 'cart_42' } },
    })

    expect(client.initializePreAuth).toHaveBeenCalledWith(
      expect.objectContaining({ basketId: 'cart_42' })
    )
  })
})

describe('authorizePayment', () => {
  function signedSuccess(): IyzipayResult {
    const base: IyzipayResult = {
      status: 'success',
      paymentStatus: 'SUCCESS',
      phase: 'PRE_AUTH',
      paymentId: 'pay_1',
      currency: 'TRY',
      basketId: 'b1',
      conversationId: 'conv_1',
      paidPrice: '300.0',
      price: '300.0',
      token: 'tok_1',
      itemTransactions: [{ paymentTransactionId: 'ptx_1' }],
    }
    base.signature = computeHmacSha256(
      ['pay_1', 'TRY', 'b1', 'conv_1', '300.0', '300.0', 'tok_1'],
      options.secretKey
    )
    return base
  }

  it('returns AUTHORIZED with a valid signature and extracts the transaction id', async () => {
    client.retrieveCheckoutForm.mockResolvedValue(signedSuccess())
    const service = makeService()

    const result = await service.authorizePayment({
      data: { token: 'tok_1', conversationId: 'conv_1' },
    })

    expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
    expect(result.data).toMatchObject({ paymentId: 'pay_1', paymentTransactionId: 'ptx_1' })
  })

  it('throws on an invalid signature', async () => {
    const tampered = signedSuccess()
    tampered.signature = 'deadbeef'
    client.retrieveCheckoutForm.mockResolvedValue(tampered)
    const service = makeService()

    await expect(
      service.authorizePayment({ data: { token: 'tok_1', conversationId: 'conv_1' } })
    ).rejects.toThrow(/signature/i)
  })

  it('throws when no token is present', async () => {
    const service = makeService()
    await expect(service.authorizePayment({ data: {} })).rejects.toThrow(/token/i)
  })

  it('returns ERROR when the result has a valid signature but paymentStatus FAILURE', async () => {
    const base: IyzipayResult = {
      status: 'success',
      paymentStatus: 'FAILURE',
      phase: 'PRE_AUTH',
      paymentId: 'pay_err',
      currency: 'TRY',
      basketId: 'b1',
      conversationId: 'conv_1',
      paidPrice: '300.0',
      price: '300.0',
      token: 'tok_1',
      itemTransactions: [],
    }
    base.signature = computeHmacSha256(
      ['pay_err', 'TRY', 'b1', 'conv_1', '300.0', '300.0', 'tok_1'],
      options.secretKey
    )
    client.retrieveCheckoutForm.mockResolvedValue(base)
    const service = makeService()

    const result = await service.authorizePayment({
      data: { token: 'tok_1', conversationId: 'conv_1' },
    })

    expect(result.status).toBe(PaymentSessionStatus.ERROR)
  })

  it('persists ALL item transaction ids for a multi-sub-merchant basket', async () => {
    const multi = signedSuccess()
    multi.itemTransactions = [
      { paymentTransactionId: 'ptx_1' },
      { paymentTransactionId: 'ptx_2' },
      { paymentTransactionId: 'ptx_3' },
    ]
    client.retrieveCheckoutForm.mockResolvedValue(multi)
    const service = makeService()

    const result = await service.authorizePayment({
      data: { token: 'tok_1', conversationId: 'conv_1' },
    })

    // First id remains the default single-refund target; all ids are kept so the app
    // can refund each seller's portion (refunds are per-transaction).
    expect(result.data).toMatchObject({
      paymentTransactionId: 'ptx_1',
      paymentTransactionIds: ['ptx_1', 'ptx_2', 'ptx_3'],
    })
  })
})

describe('capturePayment', () => {
  it('delegates to a full postauth when a paymentId is present', async () => {
    client.postAuthFull.mockResolvedValue({ status: 'success' })
    const service = makeService()

    await service.capturePayment({ data: { paymentId: 'pay_1', conversationId: 'conv_1' } })

    expect(client.postAuthFull).toHaveBeenCalledWith({
      paymentId: 'pay_1',
      conversationId: 'conv_1',
    })
  })

  it('throws when no paymentId is present', async () => {
    const service = makeService()
    await expect(service.capturePayment({ data: {} })).rejects.toThrow(/paymentId/i)
  })
})

describe('cancelPayment', () => {
  it('voids the preauth when a paymentId is present', async () => {
    client.cancel.mockResolvedValue({ status: 'success' })
    const service = makeService()

    await service.cancelPayment({ data: { paymentId: 'pay_1' } })

    expect(client.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_1' })
    )
  })

  it('is a no-op when nothing was authorized', async () => {
    const service = makeService()
    const result = await service.cancelPayment({ data: {} })
    expect(client.cancel).not.toHaveBeenCalled()
    expect(result.data).toEqual({})
  })
})

describe('refundPayment', () => {
  it('refunds with the amount and transaction id', async () => {
    client.refund.mockResolvedValue({ status: 'success' })
    const service = makeService()

    await service.refundPayment({
      amount: 50,
      data: { paymentTransactionId: 'ptx_1', currency: 'TRY' },
    })

    expect(client.refund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentTransactionId: 'ptx_1', price: '50', currency: 'TRY' })
    )
  })

  it('throws without a paymentTransactionId', async () => {
    const service = makeService()
    await expect(service.refundPayment({ amount: 50, data: {} })).rejects.toThrow(
      /paymentTransactionId/i
    )
  })
})

describe('getPaymentStatus mapping', () => {
  it('maps a captured (POST_AUTH) payment to CAPTURED', async () => {
    client.retrievePayment.mockResolvedValue({
      status: 'success',
      paymentStatus: 'SUCCESS',
      phase: 'POST_AUTH',
    })
    const service = makeService()

    const result = await service.getPaymentStatus({ data: { paymentId: 'pay_1' } })
    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
  })

  it('maps a preauth (PRE_AUTH) payment to AUTHORIZED', async () => {
    client.retrievePayment.mockResolvedValue({
      status: 'success',
      paymentStatus: 'SUCCESS',
      phase: 'PRE_AUTH',
    })
    const service = makeService()

    const result = await service.getPaymentStatus({ data: { paymentId: 'pay_1' } })
    expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
  })

  it('maps a FAILURE to ERROR', async () => {
    client.retrievePayment.mockResolvedValue({ status: 'success', paymentStatus: 'FAILURE' })
    const service = makeService()

    const result = await service.getPaymentStatus({ data: { paymentId: 'pay_1' } })
    expect(result.status).toBe(PaymentSessionStatus.ERROR)
  })

  it('returns PENDING when there is no paymentId yet', async () => {
    const service = makeService()
    const result = await service.getPaymentStatus({ data: {} })
    expect(result.status).toBe(PaymentSessionStatus.PENDING)
    expect(client.retrievePayment).not.toHaveBeenCalled()
  })
})

describe('deletePayment / updatePayment (no-ops)', () => {
  it('deletePayment returns the data unchanged without a gateway call', async () => {
    const service = makeService()
    const result = await service.deletePayment({ data: { token: 'tok_1' } })
    expect(result.data).toEqual({ token: 'tok_1' })
  })

  it('updatePayment returns the data unchanged without a gateway call', async () => {
    const service = makeService()
    const result = await service.updatePayment({
      amount: 300,
      currency_code: 'try',
      data: { token: 'tok_1' },
    })
    expect(result.data).toEqual({ token: 'tok_1' })
  })
})
