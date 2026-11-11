# RecruiterAI Credits and Razorpay Payments: Backend Plan

Date: 2026-11-11
Status: plan only. Nothing is built yet.
The frontend plan is in `CREDITS-PAYMENTS-FRONTEND-2026-11-11.md`.

## 1. Summary

Companies pay for interviews with credits. Each company has one credit wallet. The admin buys credits through Razorpay, and the admin and their HR users spend them when they schedule interviews.

## 2. Business rules

| Rule                  | Value                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| Credit value          | 1 credit = ₹1, excluding GST                                                       |
| GST                   | 18%, added on top at payment time                                                  |
| Free credits          | 200 credits when a company account is created (4 interviews)                       |
| Cost of one interview | 50 credits, charged when the interview is scheduled                                |
| Wallet                | One per company, shared by the admin and all HR users of that company              |
| Who can buy credits   | Admin only                                                                         |
| Who can spend credits | Admin and HR (by scheduling interviews)                                            |
| Not enough credits    | Scheduling is blocked until the admin buys more                                    |
| Expired interview     | The HR user who created it, or the admin, chooses Refund or Reschedule (section 4) |
| Admin can see         | Balance, payments, and the full credit log for the company                         |
| HR can see            | Balance only                                                                       |
| Super admin can see   | Balance, payments and usage of every company (view only)                           |

The two numbers 200 and 50 must be settings, not hard-coded, so they can change later without a release.

### GST example

The admin buys 500 credits.

| Line          | Amount |
| ------------- | ------ |
| 500 credits   | ₹500   |
| GST 18%       | ₹90    |
| Total charged | ₹590   |
| Credits added | 500    |

The Razorpay order amount is the total in paise: `59000`. GST never becomes credits.

## 3. Payment flow (Razorpay)

1. The admin picks a number of credits on the Billing page.
2. The frontend calls `POST /api/billing/orders` with the number of credits.
3. The backend calculates the amount and GST, creates a Razorpay order with the secret key, saves a `payments` row with status `created`, and returns the order id and the public key id.
4. The frontend opens Razorpay Checkout with that order id. The admin pays by UPI, card or netbanking.
5. Razorpay gives the frontend `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature`.
6. The frontend sends those three values to `POST /api/billing/verify`.
7. The backend verifies the signature (HMAC SHA256 of `order_id|payment_id` with the key secret), marks the payment `paid`, and adds the credits.
8. Razorpay also calls the webhook `POST /api/billing/razorpay-webhook` with `payment.captured`. The backend does the same work there, as a backup for when the admin closes the browser before step 6.

Rules:

- The Razorpay key secret and the webhook secret stay on the backend only. The frontend only receives the public key id.
- The amount is always calculated on the backend from the credit count. The frontend never sends an amount.
- A payment must add credits only once, even when both `verify` and the webhook arrive. Use the unique `razorpay_payment_id` to guard this.
- Verify the webhook signature with the webhook secret before trusting it.
- Use Razorpay test keys until a full test purchase works end to end.

## 4. Expired interview flow

An interview is "expired" when its link expiry time has passed and the candidate never started it.

1. A background job finds these interviews and marks them `expired`. The 50 credits stay charged for now.
2. The backend creates a notification for the HR user who created the interview and for the company admin, in the app and by email.
3. The frontend shows this question on the notification and on the Interviews page:

   > The interview for {candidate name} ({job title}) has expired. Do you want a refund, or do you want to reschedule the interview for the same candidate?

   with two buttons: **Refund 50 credits** and **Reschedule**.

4. **Refund:** 50 credits go back to the company wallet and a `refund` row is written to the credit log.
5. **Reschedule:** the same candidate gets a new link and a new expiry. No new credits are charged, because the original 50 are reused. The candidate is emailed the new invitation.
6. Only one of the two can happen, and only once per expiry. After a refund the interview cannot be rescheduled for free. A rescheduled interview that expires again asks the same question again.
7. If the candidate started the interview, there is no refund and no free reschedule.

## 5. Tables

**`company_wallets`**

| Column       | Notes                          |
| ------------ | ------------------------------ |
| `company_id` | Primary key, one per company   |
| `balance`    | Integer credits, never below 0 |
| `updated_at` |                                |

**`credit_transactions`** (the credit log, append only)

| Column          | Notes                                                       |
| --------------- | ----------------------------------------------------------- |
| `id`            |                                                             |
| `company_id`    |                                                             |
| `type`          | `signup_bonus`, `purchase`, `interview_charge`, `refund`    |
| `amount`        | Positive for credits added, negative for credits used       |
| `balance_after` | Wallet balance after this row                               |
| `interview_id`  | Set for `interview_charge` and `refund`                     |
| `payment_id`    | Set for `purchase`                                          |
| `user_id`       | Who caused it (the HR user or admin). Empty for system rows |
| `created_at`    |                                                             |

The balance must never change without a row in this table.

**`payments`**

| Column                  | Notes                              |
| ----------------------- | ---------------------------------- |
| `id`                    |                                    |
| `company_id`            |                                    |
| `user_id`               | The admin who paid                 |
| `credits`               | Credits bought                     |
| `amount_paise`          | Credits value before GST, in paise |
| `gst_paise`             | GST, in paise                      |
| `total_paise`           | What Razorpay charged              |
| `razorpay_order_id`     | Unique                             |
| `razorpay_payment_id`   | Unique, empty until paid           |
| `status`                | `created`, `paid`, `failed`        |
| `created_at`, `paid_at` |                                    |

**`notifications`**

| Column         | Notes                                     |
| -------------- | ----------------------------------------- |
| `id`           |                                           |
| `user_id`      | Who should see it                         |
| `type`         | `interview_expired` for now               |
| `interview_id` |                                           |
| `message`      |                                           |
| `resolved`     | True after Refund or Reschedule is chosen |
| `read_at`      |                                           |
| `created_at`   |                                           |

**`interviews`** (existing table): add a way to know the credit state, for example `credit_state` with values `charged` and `refunded`.

## 6. New endpoints

All use the existing `Authorization: Bearer` user token unless noted.

| Method and path                              | Who                 | Purpose                                        |
| -------------------------------------------- | ------------------- | ---------------------------------------------- |
| `GET /api/billing/wallet`                    | Admin, HR           | Balance and current prices                     |
| `GET /api/billing/transactions`              | Admin               | Credit log, paged, filter by type, user, date  |
| `GET /api/billing/payments`                  | Admin               | Payment history, paged                         |
| `POST /api/billing/orders`                   | Admin only          | Create a Razorpay order                        |
| `POST /api/billing/verify`                   | Admin only          | Verify a payment and add credits               |
| `POST /api/billing/razorpay-webhook`         | Razorpay (no token) | Backup confirmation, signature checked         |
| `POST /api/hr/interviews/{id}/refund`        | Creating HR, Admin  | Refund the credits of an expired interview     |
| `POST /api/hr/interviews/{id}/reschedule`    | Creating HR, Admin  | New link for the same candidate, no new charge |
| `GET /api/notifications`                     | Admin, HR           | The user's notifications                       |
| `POST /api/notifications/{id}/read`          | Admin, HR           | Mark one as read                               |
| `GET /api/superadmin/billing/companies`      | Super admin         | Every company: balance, bought, used           |
| `GET /api/superadmin/billing/companies/{id}` | Super admin         | One company's payments and credit log          |

An HR user calling an admin-only endpoint gets `403`.

## 7. Suggested request and response shapes

`GET /api/billing/wallet`

```json
{
  "status": "success",
  "balance": 150,
  "interview_cost": 50,
  "gst_percent": 18,
  "interviews_left": 3
}
```

`POST /api/billing/orders`

Request:

```json
{ "credits": 500 }
```

Response:

```json
{
  "status": "success",
  "order_id": "order_ABC123",
  "key_id": "rzp_test_xxxxx",
  "credits": 500,
  "amount_paise": 50000,
  "gst_paise": 9000,
  "total_paise": 59000,
  "currency": "INR"
}
```

`POST /api/billing/verify`

Request:

```json
{
  "razorpay_order_id": "order_ABC123",
  "razorpay_payment_id": "pay_XYZ789",
  "razorpay_signature": "..."
}
```

Response:

```json
{ "status": "success", "credits_added": 500, "balance": 650 }
```

`GET /api/billing/payments`

```json
{
  "status": "success",
  "count": 1,
  "payments": [
    {
      "id": "…",
      "credits": 500,
      "amount_paise": 50000,
      "gst_paise": 9000,
      "total_paise": 59000,
      "status": "paid",
      "razorpay_payment_id": "pay_XYZ789",
      "paid_by": { "userId": "…", "fullName": "Asha Admin" },
      "created_at": "2026-11-11T09:00:00Z",
      "paid_at": "2026-11-11T09:01:10Z"
    }
  ]
}
```

`GET /api/billing/transactions`

```json
{
  "status": "success",
  "count": 1,
  "transactions": [
    {
      "id": "…",
      "type": "interview_charge",
      "amount": -50,
      "balance_after": 150,
      "interview_id": "…",
      "candidate_name": "Ravi Kumar",
      "job_title": "Frontend Developer",
      "user": { "userId": "…", "fullName": "Priya HR" },
      "created_at": "2026-11-11T10:00:00Z"
    }
  ]
}
```

`POST /api/hr/interviews/{id}/refund`

```json
{ "status": "success", "credits_refunded": 50, "balance": 200 }
```

`POST /api/hr/interviews/{id}/reschedule`

Request (optional, defaults as in scheduling today):

```json
{ "link_expiry_hours": 48 }
```

Response: the same shape the schedule endpoint returns today for one interview, with the new link and expiry.

`GET /api/notifications`

```json
{
  "status": "success",
  "unread": 1,
  "notifications": [
    {
      "id": "…",
      "type": "interview_expired",
      "interview_id": "…",
      "candidate_name": "Ravi Kumar",
      "job_title": "Frontend Developer",
      "message": "The interview for Ravi Kumar (Frontend Developer) has expired.",
      "resolved": false,
      "read_at": null,
      "created_at": "2026-11-11T12:00:00Z"
    }
  ]
}
```

`GET /api/superadmin/billing/companies`

```json
{
  "status": "success",
  "companies": [
    {
      "company_id": "…",
      "company_name": "Citimedia",
      "balance": 150,
      "credits_bought": 1000,
      "credits_used": 1050,
      "amount_paid_paise": 118000,
      "last_payment_at": "2026-11-10T09:00:00Z"
    }
  ]
}
```

## 8. Changes to existing behaviour

- **Company creation:** create the wallet with 200 credits and write a `signup_bonus` row.
- **Existing companies:** a one-time migration that gives each one a wallet with 200 credits.
- **Scheduling** (`POST /api/hr/jobs/{job_id}/schedule` and `POST /api/hr/interviews`):
  - Cost is 50 × the number of interviews created.
  - Check the balance and deduct inside one database transaction with a row lock on the wallet, so two people scheduling at the same moment cannot overspend.
  - Either all the interviews in the request are created and charged, or none are.
  - Write one `interview_charge` row per interview.
- **Not enough credits:** respond `402` with a JSON body the frontend can read:

  ```json
  {
    "detail": "Not enough credits",
    "code": "insufficient_credits",
    "balance": 30,
    "required": 100
  }
  ```

- **Interviews created with API keys (`csk_`):** charged the same way.
- **Expiry job:** a scheduled job (for example every 15 minutes) that marks unstarted interviews past their expiry as `expired` and creates the notifications and emails from section 4.
- **Interview list and detail responses:** include whether the interview is expired and whether Refund or Reschedule is still available, so the frontend can show the buttons.
- **Super admin settings:** two new values, free credits on signup (200) and credits per interview (50).

## 9. Environment variables

| Name                      | Notes                                               |
| ------------------------- | --------------------------------------------------- |
| `RAZORPAY_KEY_ID`         | Public id, returned to the frontend with each order |
| `RAZORPAY_KEY_SECRET`     | Secret, backend only                                |
| `RAZORPAY_WEBHOOK_SECRET` | Secret, backend only                                |

The webhook URL to register in the Razorpay dashboard is `https://<backend>/api/billing/razorpay-webhook`, for the `payment.captured` and `payment.failed` events.

## 10. Open questions

1. **No one answers the expired question:** do the credits stay held until someone chooses, or are they refunded automatically after some days (for example 7)? This plan assumes they stay held.
2. **Minimum purchase:** this plan assumes a minimum of 50 credits (one interview).
3. **GST invoice:** does the admin need a downloadable GST invoice for each payment? If yes, the backend needs the company's GSTIN and billing address.
4. **Credits expiry:** this plan assumes credits never expire.

## 11. Build order

1. Wallet, credit log, signup bonus, migration for existing companies.
2. Charge at scheduling, with the `402` response.
3. Razorpay orders, verify and webhook, with test keys.
4. Expiry job, notifications, Refund and Reschedule.
5. Super admin billing endpoints and the two settings.
6. Full test purchase with the frontend, then switch to live Razorpay keys.
