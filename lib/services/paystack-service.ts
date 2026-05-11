// Server-only — never import in client components
import { createHmac } from "crypto";
import type { WithdrawalRequest } from "@/types/domain";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "";
const BASE = "https://api.paystack.co";

// Paystack Ghana MoMo bank codes
const MOMO_CODES: Record<string, string> = {
  MTN: "MTN",
  Vodafone: "VOD",
  AirtelTigo: "ATL",
};

async function paystackPost<T>(path: string, body: object): Promise<{ ok: boolean; data: T; message: string }> {
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
  return expected === signature;
}

export const paystackConfigured = () => !!PAYSTACK_SECRET;
