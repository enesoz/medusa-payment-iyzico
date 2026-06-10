import { ModuleProvider, Modules } from '@medusajs/framework/utils'
import IyzicoProviderService from './service'

export * from './types'
export { IyzicoProviderService }

export default ModuleProvider(Modules.PAYMENT, {
  services: [IyzicoProviderService],
})
