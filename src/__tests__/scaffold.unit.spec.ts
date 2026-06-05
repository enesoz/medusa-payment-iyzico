import { name, license, peerDependencies } from '../../package.json'

// Bootstrap smoke spec — keeps CI's test job honest until the provider
// implementation (story 20.2) brings real specs.
describe('package scaffold', () => {
  it('is the medusa-payment-iyzico package under MIT', () => {
    expect(name).toBe('medusa-payment-iyzico')
    expect(license).toBe('MIT')
  })

  it('pins the Medusa framework as a peer dependency', () => {
    expect(peerDependencies['@medusajs/framework']).toBeDefined()
    expect(peerDependencies['@medusajs/medusa']).toBeDefined()
  })
})
