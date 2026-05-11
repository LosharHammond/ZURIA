"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, indexedDBLocalPersistence, setPersistence } from "firebase/auth";
import {
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
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

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
