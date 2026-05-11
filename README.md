# ZURIA

ZURIA is an AI-assisted business memory MVP for African SMEs.

## Run locally

1. Copy `.env.example` to `.env.local` and add Firebase web app values.
2. Enable Firebase Authentication with Phone provider.
3. Create Firestore and deploy `firestore.rules` plus `firestore.indexes.json`.
4. Run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Core flows

- Phone OTP login with Firebase Auth.
- Onboarding for owner, business category, location, and language.
- Natural language transaction parser for sales, expenses, debts, repayments, and stock purchases.
- Firestore-backed transactions, debts, inventory, summaries, and notifications.
- IndexedDB offline queue with automatic sync when connectivity returns.
- Mobile-first dashboard with daily summary, charts, health score, debts, stock alerts, and smart reminders.
