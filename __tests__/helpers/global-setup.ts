/**
 * Global Jest setup — runs once before all test suites.
 * Stubs Firebase Admin SDK so tests never touch a real Firestore.
 */
export default async function globalSetup() {
  // Nothing needed at global level — per-file mocks handle Firebase.
  // NODE_ENV is set by Jest automatically; additional env vars:
  (process.env as Record<string, string>)["NODE_ENV"] = "test";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "zuria-test";
}
