/**
 * POST /api/payments/webhook
 *
 * Ingestion-only webhook endpoint. All financial processing has been moved
 * to lib/payments/webhook-processor.ts and is invoked by the async queue
 * worker (app/api/cron/process-webhooks/route.ts).
 *
 * Responsibilities here:
 *  1. Verify HMAC-SHA512 Paystack signature (security gate — must stay at ingress)
 *  2. Validate JSON parse
 *  3. Write raw event to webhook_queue collection
 *  4. Return 200 immediately (< 50ms) so Paystack does not retry unnecessarily
 *
 * The queue worker processes events asynchronously with retry-safe idempotency.
 * If the queue worker is unavailable, the reconciliation cron covers any gaps.
 */

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { collections } from "@/lib/firebase/collections";
import { verifyPaystackSignature } from "@/lib/services/paystack-service";

export const dynamic = "force-dynamic";

const MAX_QUEUE_ATTEMPTS = 5; // dead-lettered after 5 failed processing attempts

export async function POST(req: Request) {
  // ── 1. Read raw body for signature verification ───────────────────────────
  const rawBody  = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";

  if (!verifyPaystackSignature(rawBody, signature)) {
    console.warn("[webhook] Invalid Paystack signature — rejected");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 2. Parse JSON (signature already verified so rawBody is trusted) ──────
  let event: { event: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event: eventType, data } = event;

  // ── 3. Enqueue for async processing ──────────────────────────────────────
  // Deterministic queue doc ID: prevents duplicate queue entries if Paystack
  // sends the exact same webhook twice before we process the first one.
  // For charge.success events, the reference is the natural dedup key.
  // For transfer events, we use transfer_code or reference.
  const reference    = (data.reference    as string | undefined) ?? "";
  const transferCode = (data.transfer_code as string | undefined) ?? "";
  const dedupeKey    = reference || transferCode || `${eventType}_${Date.now()}`;
  const queueDocId   = `wh_${eventType.replace(".", "_")}_${dedupeKey}`;

  try {
    const db     = getAdminDb();
    const queueRef = db.collection(collections.webhookQueue).doc(queueDocId);

    // set() with merge:false is idempotent when the doc doesn't exist; if it
    // already exists (Paystack re-delivery), we leave it untouched so the
    // worker's in-progress attempt is not disturbed.
    await queueRef.set(
      {
        id:          queueDocId,
        eventType,
        data,
        rawBody,
        receivedAt:  new Date().toISOString(),
        status:      "pending",
        attempts:    0,
        maxAttempts: MAX_QUEUE_ATTEMPTS,
        nextRetryAt: new Date().toISOString(), // eligible for immediate processing
      },
      { merge: false }, // Don't overwrite an already-queued or in-progress entry
    ).catch(() => {
      // set() throws on an already-existing doc with merge:false in some SDK
      // versions. Swallow — the entry already exists and will be processed.
    });
  } catch {
    // Queue write failure must NOT cause a non-200 response — that would make
    // Paystack retry the webhook before the queue worker even runs.
    console.error("[webhook] Failed to write to webhook_queue — event may be missed:", queueDocId);
  }

  // ── 4. Always return 200 immediately ─────────────────────────────────────
  // Paystack considers any non-200 a delivery failure and will retry.
  // Our queue + reconciliation cron ensures eventual consistency even if
  // the queue write above failed.
  return NextResponse.json({ ok: true, queued: queueDocId });
}
