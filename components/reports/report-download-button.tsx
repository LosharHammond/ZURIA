"use client";

import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";

type ReportType = "daily" | "weekly" | "monthly";

interface Props {
  type: ReportType;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  className?: string;
  size?: "default" | "sm";
}

const TYPE_LABELS: Record<ReportType, string> = {
  daily:   "Daily Report",
  weekly:  "Weekly Report",
  monthly: "Monthly Report",
};

export function ReportDownloadButton({
  type,
  label,
  variant = "outline",
  className,
  size = "default",
}: Props) {
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    if (!firebaseUser) return;
    setLoading(true);
    setError("");
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/reports/pdf?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not generate report. Check your subscription plan.");
        return;
      }
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      // Open in new tab — browser print dialog fires automatically
      const win = window.open(url, "_blank");
      if (!win) {
        // Fallback: download file
        const a = document.createElement("a");
        a.href = url;
        a.download = `ZURIA-${type}-report.html`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <Button
        variant={variant}
        size={size}
        onClick={download}
        disabled={loading}
        className={className}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileText className="mr-2 h-4 w-4" />
        )}
        {loading ? "Generating…" : (label ?? `Download ${TYPE_LABELS[type]}`)}
        {!loading && <Download className="ml-2 h-3.5 w-3.5 opacity-60" />}
      </Button>
      {error && (
        <p className="text-xs text-destructive max-w-xs">{error}</p>
      )}
    </div>
  );
}
