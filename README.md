# Bunk And Bite — Website

This package converts the existing Bunk And Bite frontend into a server-backed ordering starter.

## Run locally

1. Install Node.js 20+.
2. Open this folder in Command Prompt/PowerShell.
3. Run:
   npm install
   copy .env.example .env
   npm start
4. Open http://localhost:3000

## Real payment

The site uses Razorpay Checkout. To enable online payments:

- Create/activate a Razorpay merchant account.
- Put the server-side `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
- Never expose the secret key in frontend code.
- For first testing, use Razorpay test/sandbox credentials.
- Before launch, switch to live credentials and verify your Razorpay account/webhook setup.

COD works without Razorpay keys.

## What is now server-backed

- Persistent order records in `data/orders.json`
- Server-generated order numbers
- COD order creation
- Razorpay order creation
- Razorpay payment signature verification
- Order lookup/tracking API
- Order status update API

## Important production step

The current starter deliberately keeps the existing menu data in the frontend. Before public launch, move products/prices/coupons/outlets into a real database and recalculate the cart total on the server. This prevents price manipulation.

For a full production deployment, also connect:
- PostgreSQL/Supabase database
- Authentication
- Razorpay webhooks/refunds
- Email/SMS/WhatsApp provider
- Admin authentication and role-based access
- Cloud image storage
- Maps/geocoding provider
- HTTPS + production hosting
- Automated backups and logging

Do not claim payment or notifications are live until the corresponding merchant/provider credentials and production configuration are actually set.
