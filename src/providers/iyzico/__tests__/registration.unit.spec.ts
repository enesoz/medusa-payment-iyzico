import { Modules } from '@medusajs/framework/utils'
import providerExport, { IyzicoProviderService } from '../index'

// Story 20.2 AC4 (registration leg). The full medusaIntegrationTestRunner round-trip
// (real PG + Redis, provider resolves + initiatePayment round-trips a payment
// collection) is DEFERRED to Story 20.3's consumption-side integration spec on
// socialShop's full app harness — see the story file Deferrals. This test proves the
// registration WIRING is correct so the deferred app-boot test only exercises runtime.
describe('Story 20.2 AC4 — provider registration wiring', () => {
  it('exports a Payment module provider', () => {
    expect(providerExport.module).toBe(Modules.PAYMENT)
  })

  it('registers the IyzicoProviderService', () => {
    expect(providerExport.services).toContain(IyzicoProviderService)
  })

  it('declares the iyzico identifier used as the provider id (pp_iyzico_*)', () => {
    expect(IyzicoProviderService.identifier).toBe('iyzico')
  })
})
