# Activate TidySheet subscriptions

## Approved plans

| Plan | Currency | Paystack interval | Amount in cents | Customer price |
|---|---|---|---:|---:|
| Regular | USD | monthly | 1000 | $10/month |
| Premium monthly | USD | monthly | 2000 | $20/month |
| Premium annual | USD | annually | 24000 | $240/year |

Regular includes business cleaning. Premium includes both business cleaning and training dataset preparation. A $0 trial includes both for 7 days with no card required and no automatic charge. Paid renewals continue until cancelled. A free business sample is always available.

## Merchant setup

1. Activate your own Paystack business account. Enable international/USD payments and supply an eligible USD settlement bank account if Paystack requires it. Paystack lists USD collection for Kenya and Nigeria; Kenya USD payouts require a USD account at a Kenyan bank. See [Paystack's international-payments guidance](https://support.paystack.com/en/articles/2130690).
2. In Paystack, create the three recurring USD plans above. Copy their `PLN_...` codes. The app checks their prices and intervals against the approved amounts; an unexpected plan fails closed.
3. Configure the following production runtime entries in the Site's environment settings. These are separate from GitHub and `.openai/hosting.json`:

| Name | Value | Secret? |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | Your Paystack secret for the chosen test/live mode | Yes |
| `PAYSTACK_REGULAR_PLAN_CODE` | The $10 monthly Regular USD plan code | Recommended |
| `PAYSTACK_MONTHLY_PLAN_CODE` | The $20 monthly USD plan code | Recommended |
| `PAYSTACK_ANNUAL_PLAN_CODE` | The $240 annual USD plan code | Recommended |
| `APP_URL` | `https://tidysheet-cleaner.sudpix4.chatgpt.site` | No |
| `TRIAL_DAYS` | `7` (one trial per account) | No |
| `SUPPORT_EMAIL` | Your customer support address | No |

Use Paystack test credentials and test-mode plans before live activation. Never send secret keys through repository files, screenshots, or public messages. For local work, use an ignored `.dev.vars` file; `.env.example` documents names only.

4. Set the Paystack webhook URL for the selected mode to:

```
https://tidysheet-cleaner.sudpix4.chatgpt.site/api/billing/webhook
```

The hosting audience must allow public requests so Paystack can reach the webhook. The endpoint independently verifies the HMAC SHA-512 signature over the exact raw body. Signed-in customer APIs remain protected even when the landing page is public.

5. Redeploy the saved version after configuring runtime variables so the new environment revision takes effect. Preserve the same Site ID and database.

## Verify before accepting live payments

- Check that the landing page shows Trial $0/7 days, Regular $10/month, and Premium $20/month or $240/year. Check all three configured checkout buttons.
- Sign in with ChatGPT as a test customer and choose a billing cycle. The server chooses the plan and amount; the browser sends only the selected cycle.
- Complete Paystack's **test-mode** hosted checkout. A return URL alone must not grant access: the app must verify the reference, account, USD amount, plan, customer, and subscription with Paystack.
- Confirm the account shows the purchased tier and correct paid-through date. Regular must allow business cleaning and reject training preparation once the trial has expired; Premium allows both.
- Deliver the same test webhook twice. Confirm it creates one receipt and does not add extra access time.
- Use Manage billing to cancel renewal. Confirm paid access lasts until the recorded period end, then expires.
- Test a failed renewal, a full refund, and an invalid signature. A status refresh or an unverified callback must not create paid time.
- Replace test credentials and plan codes with the live ones, redeploy, and verify that test subscriptions do not unlock live access.

No live transaction was made while implementing this application. Connecting the merchant account and performing provider-side test checkout require your Paystack setup.

## Operational notes

Paystack's [subscription documentation](https://paystack.com/docs/payments/subscriptions/) describes automatic recurring card billing. Direct Debit subscriptions are Nigeria-specific; this implementation deliberately initializes **card** subscriptions and does not claim automatic M-Pesa renewal.

Webhook processing is retry-safe. Provider validation or database failures return an error instead of acknowledging an event before it has been handled. Pending checkout sessions are reused to reduce duplicate recurring purchases; switching billing cycle during an in-progress checkout is rejected. Expiry checks consult the provider's configured checkout timeout and transaction state before permitting another attempt.

Changing the approved prices requires a deliberate code/configuration change. Do not silently edit an existing Paystack plan to bill current subscribers a different amount. This app does not implement prorated upgrades, a merchant tax engine, automated refunds, an admin support console, or non-ChatGPT identity providers.

The public landing page and chooser do not grant workspace access. The server authorizes the business and training pages separately, and validates the mode before recording a run. Trial expiry cannot be changed by client input. During an active trial, training remains available even if the customer subscribes to Regular.
