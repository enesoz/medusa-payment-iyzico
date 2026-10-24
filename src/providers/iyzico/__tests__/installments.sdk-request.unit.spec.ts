jest.mock('postman-request', () => jest.fn((
  _options: unknown,
  callback: (error: null, response: object, body: object) => void
) => callback(null, {}, { status: 'success', token: 'test-token' })))

import IyzicoProviderService from '../service'
import type { Logger } from '@medusajs/framework/types'

describe('host installment restriction through the real provider and SDK serializer', () => {
  it('serializes enabledInstallments [1] on the preauth HTTP body', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger
    const provider = new IyzicoProviderService({ logger }, {
      apiKey: 'test-key', secretKey: 'test-secret',
      baseUrl: 'https://sandbox-api.iyzipay.com', callbackUrl: 'https://example.com/callback',
    })
    await provider.initiatePayment({
      amount: 300, currency_code: 'try',
      data: { conversationId: 'installments-test', request: {
        enabledInstallments: [1], basketItems: [], buyer: {}, shippingAddress: {}, billingAddress: {},
      } },
    })
    const transport = jest.requireMock<jest.Mock>('postman-request')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: 'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/preauth/ecom',
      json: { enabledInstallments: [1], price: '300.0', paidPrice: '300.0', currency: 'TRY' },
    })
  })
})
