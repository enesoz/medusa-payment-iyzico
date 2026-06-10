jest.mock('../client')

import type { Logger, ProviderWebhookPayload } from '@medusajs/framework/types'
import IyzicoProviderService from '../service'
import { IyzicoProviderOptions } from '../types'
import { computeHmacSha256 } from '../signature'

const options: IyzicoProviderOptions = {
  apiKey: 'test-key',
  secretKey: 'test-secret',
  baseUrl: 'https://sandbox-api.iyzipay.com',
  callbackUrl: 'https://example.com/cb',
}

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as unknown as Logger

function service(): IyzicoProviderService {
  return new IyzicoProviderService({ logger }, options)
}

function payload(data: Record<string, unknown>): ProviderWebhookPayload['payload'] {
  return { data, rawData: JSON.stringify(data), headers: {} }
}

function signedCallback(mdStatus: string, status: string): Record<string, unknown> {
  const fields = ['', 'sess_1', mdStatus, 'pay_1', status]
  return {
    conversationData: '',
    conversationId: 'sess_1',
    mdStatus,
    paymentId: 'pay_1',
    status,
    paidPrice: '300.0',
    signature: computeHmacSha256(fields, options.secretKey),
  }
}

describe('getWebhookActionAndData — synchronous 3DS callback', () => {
  it('returns authorized for a valid signature + mdStatus=1', async () => {
    const result = await service().getWebhookActionAndData(payload(signedCallback('1', 'success')))
    expect(result.action).toBe('authorized')
    expect(result.data?.session_id).toBe('sess_1')
  })

  it('returns failed when mdStatus is not 1 (even with a valid signature)', async () => {
    const result = await service().getWebhookActionAndData(payload(signedCallback('0', 'success')))
    expect(result.action).toBe('failed')
  })

  it('returns failed when the signature does not verify', async () => {
    const tampered = signedCallback('1', 'success')
    tampered.signature = 'deadbeef'
    const result = await service().getWebhookActionAndData(payload(tampered))
    expect(result.action).toBe('failed')
  })
})
