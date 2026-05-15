"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, indexedDBLocalPersistence, setPersistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);

// Firestore with IndexedDB persistence enabled at init time (multi-tab aware).
// This replaces the deprecated enableIndexedDbPersistence() which had to be
// called after getFirestore() and could fail silently when multiple tabs were open.
//
// Guard: initializeFirestore throws "settings can no longer be changed" if the
// same Firebase app is already initialised (e.g. Next.js HMR re-imports this
// module while the same app instance persists in memory). Fall back to the plain
// getFirestore() accessor which is safe to call multiple times.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
})();

export const firebaseReady = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

let authPersistencePromise: Promise<void> | null = null;

/**
 * Enable IndexedDB persistence for Firebase Auth (session survives page refresh).
 * Firestore persistence is already configured above via initializeFirestore.
 * Call this once at app startup.
 */
export function initFirebasePersistence() {
  if (authPersistencePromise) return authPersistencePromise;

  authPersistencePromise = (async () => {
    try {
      await setPersistence(auth, indexedDBLocalPersistence);
    } catch (e) {
      console.warn("[firebase] Auth persistence failed — falling back to in-memory:", e);
    }
  })();

  return authPersistencePromise;
}
