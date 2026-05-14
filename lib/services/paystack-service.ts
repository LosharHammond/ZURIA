// Server-only — never import in client components
import { createHmac, timingSafeEqual } from "crypto";
import type { WithdrawalRequest } from "@/types/domain";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
const BASE = "https://api.paystack.co";

// Paystack Ghana MoMo network codes
const MOMO_CODES: Record<string, string> = {
  MTN: "MTN",
  Vodafone: "VOD",
  AirtelTigo: "ATL",
  Telecel: "TGO",
};

// ─── Generic fetch helpers ─────────────────────────────────────────────────────

async function paystackPost<T>(
  path: string,
  body: object
): Promise<{ ok: boolean; data: T; message: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: json.status === true, data: json.data, message: json.message ?? "" };
}

async function paystackGet<T>(
  path: string
): Promise<{ ok: boolean; data: T; message: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    cache: "no-store",
  });
  const json = await res.json();
  return { ok: json.status === true, data: json.data, message: json.message ?? "" };
}

// ─── Initialize a payment (creates a Paystack hosted checkout session) ────────

export interface InitializePaymentParams {
  /** Dummy Paystack email derived from phone: `2330241234567@zuria.app` */
  email: string;
  /** Amount in Ghana Cedis (converted to pesewas internally) */
  amountGHS: number;
  /** Unique payment reference (nanoid / uuid) */
  reference: string;
  /** Where Paystack should redirect after payment */
  callbackUrl: string;
  /** Arbitrary metadata stored with the transaction */
  metadata: Record<string, unknown>;
  /** Allowed channels; defaults to all Ghana channels */
  channels?: string[];
  /** Display label shown on the Paystack checkout page */
  label?: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  error?: string;
}

export async function initializePayment(
  params: InitializePaymentParams
): Promise<InitializePaymentResult> {
  if (!PAYSTACK_SECRET) {
    return { authorizationUrl: "", accessCode: "", reference: params.reference, error: "Paystack not configured" };
  }

  const res = await paystackPost<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>("/transaction/initialize", {
    email: params.email,
    amount: Math.round(params.amountGHS * 100), // GHS → pesewas
    reference: params.reference,
    callback_url: params.callbackUrl,
    metadata: params.metadata,
    channels: params.channels ?? ["mobile_money", "bank_transfer", "card"],
    label: params.label,
    currency: "GHS",
  });

  if (!res.ok) {
    return { authorizationUrl: "", accessCode: "", reference: params.reference, error: res.message };
  }

  return {
    authorizationUrl: res.data.authorization_url,
    accessCode: res.data.access_code,
    reference: res.data.reference,
  };
}

// ─── Verify a transaction by reference ───────────────────────────────────────

export interface VerifyTransactionResult {
  ok: boolean;
  status: string;            // "success" | "failed" | "abandoned" | "pending"
  amountGHS: number;         // In Ghana Cedis (converted from pesewas)
  currency: string;
  paidAt?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export async function verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
  if (!PAYSTACK_SECRET) {
    return { ok: false, status: "failed", amountGHS: 0, currency: "GHS", error: "Paystack not configured" };
  }

  const res = await paystackGet<{
    status: string;
    amount: number;
    currency: string;
    paid_at?: string;
    channel?: string;
    metadata?: Record<string, unknown>;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);

  if (!res.ok || !res.data) {
    return { ok: false, status: "failed", amountGHS: 0, currency: "GHS", error: res.message };
  }

  return {
    ok: res.data.status === "success",
    status: res.data.status,
    amountGHS: (res.data.amount ?? 0) / 100, // pesewas → GHS
    currency: res.data.currency ?? "GHS",
    paidAt: res.data.paid_at,
    channel: res.data.channel,
    metadata: res.data.metadata,
  };
}

// ─── Create a transfer recipient (MoMo or bank) ───────────────────────────────

export async function createTransferRecipient(
  wd: WithdrawalRequest
): Promise<{ recipientCode: string; error?: string }> {
  if (!PAYSTACK_SECRET) return { recipientCode: "", error: "Paystack not configured" };

  const body =
    wd.method === "momo"
      ? {
          type: "mobile_money",
          name: wd.accountName,
          account_number: wd.accountNumber,
          bank_code: MOMO_CODES[wd.network ?? "MTN"],
          currency: "GHS",
        }
      : {
          type: "ghipss",
          name: wd.accountName,
          account_number: wd.accountNumber,
          currency: "GHS",
        };

  const res = await paystackPost<{ recipient_code: string }>("/transferrecipient", body);
  if (!res.ok) return { recipientCode: "", error: res.message };
  return { recipientCode: res.data.recipient_code };
}

// ─── Initiate a transfer ──────────────────────────────────────────────────────
// NOTE: Enable "Automation" in Paystack dashboard (Settings → Transfers) to
// skip OTP verification for programmatic transfers.

export async function initiateTransfer(params: {
  amountGHS: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<{ transferCode: string; status: string; error?: string }> {
  if (!PAYSTACK_SECRET) return { transferCode: "", status: "failed", error: "Paystack not configured" };

  const res = await paystackPost<{ transfer_code: string; status: string }>("/transfer", {
    source: "balance",
    amount: Math.round(params.amountGHS * 100), // GHS → pesewas
    recipient: params.recipientCode,
    reference: params.reference,
    reason: params.reason,
  });

  if (!res.ok) return { transferCode: "", status: "failed", error: res.message };
  return { transferCode: res.data.transfer_code, status: res.data.status };
}

// ─── Webhook signature verification ──────────────────────────────────────────

export function verifyPaystackSignature(rawBody: string, signature: string): boolean {
  if (!PAYSTACK_SECRET) return false;
  const expected = createHmac("sha512", PAYSTACK_SECRET).update(rawBody).digest("hex");
  // BUG-5 FIX: Use timing-safe comparison to prevent timing-oracle attacks.
  // String equality (===) leaks information about how many characters match;
  // timingSafeEqual eliminates that side-channel.
  try {
    const expectedBuf  = Buffer.from(expected,   "hex");
    const signatureBuf = Buffer.from(signature ?? "", "hex");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}

export const paystackConfigured = () => !!PAYSTACK_SECRET;
