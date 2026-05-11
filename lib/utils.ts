import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { GHANA_CEDI } from "@/constants/business";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number) {
  return GHANA_CEDI.format(Number.isFinite(value) ? value : 0);
}

export function createId(prefix = "zuria") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function compactName(value?: string) {
  return value?.trim().replace(/\s+/g, " ") || null;
}
