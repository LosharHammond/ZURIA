# ZURIA WhatsApp Integration — Twilio Setup

## How it works

Users send WhatsApp messages to your Twilio number.
ZURIA reads the message, saves data to Firestore, and replies instantly.

**Examples:**
| User sends | ZURIA does |
|---|---|
| "Sold rice 120" | Saves sale → replies with confirmation + today's total |
| "Ama owes me 200" | Creates debt record for Ama |
| "Kojo paid 100" | Records repayment, updates balance |
| "Paid ECG 50" | Records expense |
| "Borrowed 500 from Kofi" | Creates loan (you borrowed) |
| "balance" | Today's money in / out / profit |
| "who owes me" | Full debt list |
| "loans" | Open loans |
| "stock" | Inventory |
| "help" | Full command guide |

---

## Step 1 — Twilio Account

1. Sign up at [twilio.com](https://www.twilio.com)
2. Go to **Messaging → Senders → WhatsApp Senders**
3. For testing use the **Sandbox** (instant, no approval needed):
   - Go to **Messaging → Try it out → Send a WhatsApp message**
   - Your sandbox number is something like `whatsapp:+14155238886`
   - Users join by sending `join <your-keyword>` to that number
4. For production: request a WhatsApp-enabled number (takes 1–3 days)

---

## Step 2 — Get your Twilio credentials

From the [Twilio Console](https://console.twilio.com):

| Value | Where to find it |
|---|---|
| Account SID | Dashboard → Account Info |
| Auth Token | Dashboard → Account Info (click to reveal) |
| WhatsApp number | Messaging → Senders → WhatsApp Senders |

---

## Step 3 — Firebase Admin SDK credentials

1. [Firebase Console](https://console.firebase.google.com) → Project Settings → Service Accounts
2. Click **Generate new private key** → download the JSON
3. Copy three values from the JSON file:

| JSON field | Env var |
|---|---|
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |

---

## Step 4 — Add to .env.local

```env
# ── Firebase (client-side, existing) ─────────────────────────
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# ── Firebase Admin (server-side, for WhatsApp webhook) ───────
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"

# ── Twilio WhatsApp ───────────────────────────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
```

> **FIREBASE_PRIVATE_KEY tip:** paste the full key with `\n` for newlines, inside double quotes.

---

## Step 5 — Point Twilio to your webhook

**Sandbox (testing):**
1. Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Scroll to **Sandbox settings**
3. Set **"When a message comes in"** to:
   ```
   https://yourdomain.com/api/whatsapp/webhook
   ```
   Method: `HTTP POST`

**Production number:**
1. Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click your WhatsApp number → Messaging
3. Set the same webhook URL

**Local testing with ngrok:**
```bash
ngrok http 3000
# Use:  https://abc123.ngrok.io/api/whatsapp/webhook
```

---

## Step 6 — Firestore indexes

Add these in Firebase Console → Firestore → Indexes:

| Collection | Fields |
|---|---|
| `transactions` | `businessId` ASC, `createdAt` DESC |
| `debts` | `businessId` ASC, `status` ASC, `outstandingAmount` DESC |
| `loans` | `businessId` ASC, `status` ASC |
| `loans` | `businessId` ASC, `direction` ASC, `status` ASC |
| `inventory` | `businessId` ASC, `productName` ASC |
| `users` | `phoneNumber` ASC |

---

## Step 7 — User registration

Users must register in the ZURIA app with the **same phone number** they use on WhatsApp.
The webhook looks them up by phone number to find their business data.

---

## Webhook endpoint

```
POST /api/whatsapp/webhook
```

Twilio sends form data (`application/x-www-form-urlencoded`).
ZURIA replies with TwiML — no separate API call needed to send the reply.
