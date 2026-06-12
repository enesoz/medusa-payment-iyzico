// Ambient type declaration for the `iyzipay` SDK (v2.x), which ships no bundled
// types. We declare ONLY the surface this provider uses, as a typed facade. All
// loose/`unknown` typing for the third-party SDK is confined to this file so the
// rest of the provider stays strictly typed (no `any`).
//
// The SDK is CommonJS (`module.exports = Iyzipay`), so we model it with
// `export =` and merge a namespace to expose the helper types.
declare module 'iyzipay' {
  namespace Iyzipay {
    /** Every iyzipay response carries at least a `status` ("success" | "failure"). */
    interface IyzipayResult {
      status: string
      errorCode?: string
      errorMessage?: string
      conversationId?: string
      [key: string]: unknown
    }

    type IyzipayCallback = (err: Error | null, result: IyzipayResult) => void

    /** A resource exposes callback-style `create` / `retrieve` (see IyzipayResource.js). */
    interface IyzipayResource {
      create(request: Record<string, unknown>, callback: IyzipayCallback): void
      retrieve(request: Record<string, unknown>, callback: IyzipayCallback): void
    }

    interface IyzipayConfig {
      apiKey: string
      secretKey: string
      uri: string
    }
  }

  class Iyzipay {
    constructor(config: Iyzipay.IyzipayConfig)

    // Resources auto-attach with a lower-cased first letter (Iyzipay.js `_initResources`).
    checkoutFormInitializePreAuth: Iyzipay.IyzipayResource
    checkoutForm: Iyzipay.IyzipayResource
    paymentPostAuth: Iyzipay.IyzipayResource
    cancel: Iyzipay.IyzipayResource
    refund: Iyzipay.IyzipayResource
    payment: Iyzipay.IyzipayResource
    threedsInitializePreAuth: Iyzipay.IyzipayResource
    threedsPayment: Iyzipay.IyzipayResource

    static LOCALE: { TR: string; EN: string }
    static CURRENCY: { TRY: string; [key: string]: string }
    static PAYMENT_GROUP: { PRODUCT: string; LISTING: string; SUBSCRIPTION: string }
  }

  export = Iyzipay
}
