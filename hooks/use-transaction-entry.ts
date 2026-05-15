"use client";

import { useDeferredValue, useState } from "react";
import { parseTransaction } from "@/lib/parsers/transaction-parser";
import { createTransaction } from "@/lib/services/transaction-service";
import { useAppStore } from "@/stores/app-store";

export function useTransactionEntry() {
  const business     = useAppStore((s) => s.business);
  const user         = useAppStore((s) => s.user);
  const addTransaction = useAppStore((s) => s.addTransaction);
  const [text, setText]   = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ── Defer the parser ───────────────────────────────────────────────────────
  // parseTransaction runs 1,438+ pattern checks. On low-end Android phones this
  // creates a noticeable jank on every keystroke. useDeferredValue lets React
  // keep the textarea responsive by running the parse in a lower-priority pass.
  // On fast devices the deferred value resolves synchronously; on slow devices
  // React schedules it between frames so input stays smooth.
  const deferredText = useDeferredValue(text);
  const parsed = deferredText.trim() ? parseTransaction(deferredText) : undefined;

  async function submit() {
    if (!business?.id || !user?.id || !text.trim() || !parsed || parsed.amount <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const transaction = await createTransaction({
        businessId: business.id,
        userId: user.id,
        rawText: text,
        parsed,
      });
      addTransaction(transaction);
      setText("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save. Try again.";
      setError(msg);
      console.error("[useTransactionEntry] submit failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return { text, setText, parsed, saving, error, submit };
}
