"use client";

import { useEffect } from "react";
import { initFirebasePersistence } from "@/lib/firebase/config";

export function FirebaseBootstrap() {
  useEffect(() => {
    initFirebasePersistence().catch((err) => {
      console.warn("[firebase] Persistence init failed — falling back to in-memory:", err);
    });
  }, []);

  return null;
}