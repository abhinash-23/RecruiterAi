# RecruiterAI Credits and Razorpay Payments: Frontend Plan

Date: 2026-11-11
Status: plan only. Nothing is built yet.
The backend plan, with the tables and the full request and response shapes, is in `CREDITS-PAYMENTS-BACKEND-2026-11-11.md`.

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
| Expired interview     | The HR user who created it, or the admin, chooses Refund or Reschedule (section 5) |
| Admin can see         | Balance, payments, and the full credit log for the company                         |
| HR can see            | Balance only                                                                       |
| Super admin can see   | Balance, payments and usage of every company (view only)                           |

The prices (50 per interview, 18% GST) come from `GET /api/billing/wallet`. They must not be hard-coded in the frontend.

## 3. Screens by role

### Admin

**Billing page** (new, in the admin menu)

- **Balance card:** current credits and how many interviews they cover.
- **Buy credits:** packs (for example 500, 1000, 2500) or a typed number, minimum 50. Before paying, show the breakdown:

  | Line         | Amount |
  | ------------ | ------ |
  | 500 credits  | ₹500   |
  | GST 18%      | ₹90    |
  | Total to pay | ₹590   |

- **Payments table:** date, credits, amount, GST, total, status (paid / failed), payment id.
- **Credit log table:** date, type (free credits, purchase, interview, refund), HR user, candidate and job, credits (+/-), balance after. Filters by type, HR user and date.

### HR

- No Billing page and no buy button.
- When the balance is too low, the schedule button is disabled with the message "Not enough credits. Ask your admin to add credits."

### Admin and HR

- **Balance chip** in the dashboard header, on every page. It turns amber when fewer than 2 interviews are left.
- **Schedule dialog and New interview dialog:** a cost line such as "3 interviews × 50 = 150 credits. Balance: 200." When the balance is short, the submit button is disabled. The admin sees a "Buy credits" link, and HR sees the "ask your admin" message.
- **Notification bell** in the header, with an unread count. Expired interviews appear here (section 5).
- **Interviews page:** expired rows show an "Expired" badge with the Refund and Reschedule actions.

### Super admin

- **Credits page** (new): a table of companies with balance, credits bought, credits used, amount paid and last payment. Opening a company shows its payments and credit log. View only.
- **System settings:** two new fields, free credits on signup and credits per interview.

## 4. Buying credits (Razorpay Checkout)

1. The admin picks the number of credits and clicks Pay.
2. Call `POST /api/billing/orders` with `{ "credits": 500 }`. The response has `order_id`, `key_id`, `total_paise` and the GST breakdown.
3. Load `https://checkout.razorpay.com/v1/checkout.js` (only now, not on page load) and open Checkout with `key_id`, `order_id`, the company name, and the admin's name and email prefilled.
4. On success, Razorpay returns `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature`. Send all three to `POST /api/billing/verify`.
5. On a successful verify, show "500 credits added", and refresh the balance, the payments table and the credit log.
6. If the admin closes the popup, show nothing alarming and leave the page as it was.
7. If the payment fails, show Razorpay's reason and let the admin try again.
8. If verify fails but money was taken, show "Payment received. Your credits will appear shortly." The backend webhook adds the credits, so refetch the balance after a short delay.

Rules:

- The frontend never holds the Razorpay key secret. It gets the public `key_id` from the order response.
- The frontend never sends an amount, only the credit count. The backend calculates the price.

## 5. Expired interview: Refund or Reschedule

When an interview link expires and the candidate never started, the HR user who created it and the admin both get a notification.

The notification, and the expired row on the Interviews page, show:

> The interview for {candidate name} ({job title}) has expired. Do you want a refund, or do you want to reschedule the interview for the same candidate?

with two buttons:

- **Refund 50 credits:** calls `POST /api/hr/interviews/{id}/refund`. On success, show "50 credits refunded" and refresh the balance.
- **Reschedule:** opens a small dialog to pick the new link expiry, then calls `POST /api/hr/interviews/{id}/reschedule`. No new credits are charged. On success, show "New invitation sent to {candidate}".

After either action, the notification is marked resolved and the buttons disappear for both the HR user and the admin. If the other person already acted, show "Already handled" instead of an error.

## 6. Endpoints the frontend uses

| Method and path                              | Used by            | Where                              |
| -------------------------------------------- | ------------------ | ---------------------------------- |
| `GET /api/billing/wallet`                    | Admin, HR          | Header chip, dialogs, Billing page |
| `GET /api/billing/transactions`              | Admin              | Credit log table                   |
| `GET /api/billing/payments`                  | Admin              | Payments table                     |
| `POST /api/billing/orders`                   | Admin              | Buy credits                        |
| `POST /api/billing/verify`                   | Admin              | After Razorpay Checkout succeeds   |
| `POST /api/hr/interviews/{id}/refund`        | Creating HR, Admin | Refund button                      |
| `POST /api/hr/interviews/{id}/reschedule`    | Creating HR, Admin | Reschedule button                  |
| `GET /api/notifications`                     | Admin, HR          | Notification bell                  |
| `POST /api/notifications/{id}/read`          | Admin, HR          | Marking a notification read        |
| `GET /api/superadmin/billing/companies`      | Super admin        | Credits page                       |
| `GET /api/superadmin/billing/companies/{id}` | Super admin        | Company detail                     |

The existing scheduling calls (`POST /api/hr/jobs/{job_id}/schedule` and `POST /api/hr/interviews`) stay the same, with one new error: `402` with code `insufficient_credits`, plus `balance` and `required`.

## 7. Error handling

| Case                              | What the user sees                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `402 insufficient_credits`        | "Not enough credits. You need 100 and have 30." Admin gets a link to Billing. Dialog stays open. |
| `403` on a buy endpoint           | Should not happen, because HR has no buy button. Show the standard permission message.           |
| Refund or reschedule already done | "Already handled", then refresh the list.                                                        |
| Wallet request fails              | The chip shows nothing rather than a wrong number. Scheduling still relies on the backend check. |

## 8. Implementation notes

- **Service and hooks:** a new `src/services/billing` module with TanStack Query hooks, in the same style as `src/services/hr`.
- **Refreshing the balance:** invalidate the wallet query after scheduling, buying, refunding and rescheduling.
- **Notifications:** poll `GET /api/notifications` every minute or so while the dashboard is open. No WebSocket is needed for this.
- **Routes:** `/admin/billing` and `/superadmin/credits`, loaded lazily like the other pages.
- **Money display:** amounts arrive in paise. Show them as rupees with the `en-IN` number format.
- **Security headers:** if a Content-Security-Policy is added later, it must allow `checkout.razorpay.com` and `api.razorpay.com`.

## 9. Open questions

1. **No one answers the expired question:** do the credits stay held, or are they refunded automatically after some days? This plan assumes they stay held.
2. **Minimum purchase:** this plan assumes 50 credits.
3. **GST invoice:** should the Payments table have a "Download invoice" link?
4. **Credit packs:** which pack sizes to offer (this plan suggests 500, 1000 and 2500).

## 10. Build order

1. Billing service and the balance chip in the header.
2. Cost line and blocked state in the two scheduling dialogs, and the `402` message.
3. Admin Billing page with Razorpay Checkout (test keys).
4. Notification bell, and Refund and Reschedule on the Interviews page.
5. Super admin Credits page and the two settings fields.
6. Full test purchase with the backend, then switch to live keys.
