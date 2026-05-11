"use client";

import { openDB, type DBSchema } from "idb";
import type { Transaction } from "@/types/domain";

interface ZuriaDB extends DBSchema {
  queuedTransactions: {
    key: string;
    value: Transaction;
    indexes: { "by-createdAt": string };
  };
}

const DB_NAME = "zuria-offline";
const DB_VERSION = 1;

async function getDatabase() {
  return openDB<ZuriaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("queuedTransactions")) {
        const store = db.createObjectStore("queuedTransactions", { keyPath: "id" });
        store.createIndex("by-createdAt", "createdAt");
      }
    }
  });
}

export async function queueTransaction(transaction: Transaction) {
  const db = await getDatabase();
  await db.put("queuedTransactions", { ...transaction, synced: undefined });
}

export async function getQueuedTransactions() {
  const db = await getDatabase();
  return db.getAllFromIndex("queuedTransactions", "by-createdAt");
}

export async function removeQueuedTransaction(id: string) {
  const db = await getDatabase();
  await db.delete("queuedTransactions", id);
}
