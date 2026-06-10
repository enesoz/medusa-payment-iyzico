# medusa-payment-iyzico

> **Iyzico payment provider for [MedusaJS](https://medusajs.com) v2** — the first of its kind.
> Implements Medusa's `AbstractPaymentProvider` lifecycle (initiate → authorize → capture, with refund/cancel) over the official [`iyzipay`](https://github.com/iyzico/iyzipay-node) SDK, using Iyzico's preauth/postauth APIs.

[![CI](https://github.com/enesoz/medusa-payment-iyzico/actions/workflows/ci.yml/badge.svg)](https://github.com/enesoz/medusa-payment-iyzico/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Status

🚧 **Pre-release — under active development.** This plugin is maintained primarily for our own production use; issues and PRs are welcome, but the roadmap follows our production needs. Do not use in production before v1.0.0.

| Milestone | Status |
|---|---|
| Repo bootstrap (scaffold, CI, secrets hygiene) | ✅ |
| Production settlement verification (real-key gate) | ⏳ |
| `AbstractPaymentProvider` skeleton | ✅ |
| Checkout integration proven in a production app | ⏳ |
| npm v1.0.0 | ⏳ |

## Design constraints (read before using)

These come from sandbox + documentation research against Iyzico's API (June 2026):

- **Capture is full-amount only — by construction.** Iyzico's partial `postAuth` prorates the capture **globally across all basket items and sub-merchants** (and drives `merchantCommissionRateAmount` negative). Medusa's payment module never passes a capture amount to a provider, and this provider's `capturePayment` issues a full `postAuth` with **no `paidPrice`** — so a partial amount can never reach Iyzico. Handle partial fulfillment via refunds after a full capture; never request a partial capture at the module/admin layer (that records partial in Medusa while Iyzico captures full).
- **25-day capture window.** Per BKM rules a preauth must be captured within 25 days (bank-variant) or it auto-voids. Iyzico emits **no expiry webhook** — schedule your own capture-deadline watchdog.
- **No async settlement webhooks.** The only callback is the synchronous 3DS/hosted-form POST (`paymentId` / `mdStatus` / `signature`).
- **3DS preauth flow:** `POST /payment/3dsecure/initialize/preauth` → WebView (`threeDSHtmlContent`) → callback → `POST /payment/3dsecure/auth` → later `POST /payment/postauth`. A hosted-form preauth variant (`/payment/iyzipos/checkoutform/initialize/preauth/ecom`) also exists.

## Local development

This is a Medusa v2 plugin project. Develop against a local Medusa app with:

```bash
npm install
npm run dev          # medusa plugin:develop — publishes to yalc and watches
```

In the consuming Medusa app:

```bash
npx yalc add medusa-payment-iyzico
```

Consuming apps should pin **tagged releases** on their main branch; `plugin:develop`/yalc is for local iteration only.

## Configuration (target shape — subject to change before v1.0.0)

```ts
// medusa-config.ts
modules: [
  {
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [
        {
          resolve: "medusa-payment-iyzico/providers/iyzico",
          id: "iyzico",
          options: {
            apiKey: process.env.IYZICO_API_KEY,
            secretKey: process.env.IYZICO_SECRET_KEY,
            baseUrl: process.env.IYZICO_BASE_URL,       // sandbox or production
            callbackUrl: process.env.IYZICO_CALLBACK_URL, // 3DS/hosted-form callback
          },
        },
      ],
    },
  },
]
```

**Never commit keys.** This repo enforces a pre-push secret scan (`.githooks/pre-push`, auto-configured via the `prepare` script) and CI secret scanning. Sandbox keys belong in CI secrets; production keys belong in your deployment environment.

## Scope

In scope: the generic single-payment card lifecycle (initiate / authorize / capture / refund / cancel / status / retrieve) including marketplace `subMerchantKey` pass-through on basket items.

Out of scope (belongs in your app): commission calculation, sub-merchant onboarding/KYC, payout scheduling, reserve holds, and any business-specific money logic.

## License

[MIT](LICENSE) © Enes Ozdemir
