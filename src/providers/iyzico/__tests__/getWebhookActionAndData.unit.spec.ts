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

// Mirrors the REAL Iyzico 3DS callback POST body: paymentId / conversationId /
// conversationData / mdStatus / status / signature — and deliberately NO paidPrice/price
// (the gateway does not send an amount on this event; see AC3 note #2). The handler's
// returned `amount` is therefore 0, which is harmless: core-flows authorizes the session
// by `session_id` and never reads the webhook amount for the `authorized` action.
function signedCallback(mdStatus: string, status: string): Record<string, unknown> {
  const fields = ['', 'sess_1', mdStatus, 'pay_1', status]
  return {
    conversationData: '',
    conversationId: 'sess_1',
    mdStatus,
    paymentId: 'pay_1',
    status,
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

  it('returns failed (does not throw) for a same-length non-hex signature', async () => {
    // Regression: a 64-char NON-hex signature passes the length guard but, if decoded as
    // hex, truncates to a shorter buffer than the 32-byte digest → timingSafeEqual throws
    // RangeError and 500s the callback route. The handler must fail closed, not crash.
    const expectedLen = computeHmacSha256(['', 'sess_1', '1', 'pay_1', 'success'], options.secretKey)
      .length
    const malicious = signedCallback('1', 'success')
    malicious.signature = 'g'.repeat(expectedLen) // same length, non-hex
    const result = await service().getWebhookActionAndData(payload(malicious))
    expect(result.action).toBe('failed')
  })

  it('returns failed when status is absent (fails closed)', async () => {
    const noStatus = signedCallback('1', 'success')
    delete noStatus.status
    const result = await service().getWebhookActionAndData(payload(noStatus))
    expect(result.action).toBe('failed')
  })
})
