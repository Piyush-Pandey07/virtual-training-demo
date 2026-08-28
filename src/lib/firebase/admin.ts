/**
 * Firebase on the server: verifying who somebody is.
 *
 * Three environment variables, not a JSON file on disk, because Vercel has no disk
 * to put one on. The private key is the one genuinely secret value in this app's
 * configuration.
 *
 * That key is a PEM block with real newlines in it, and every way of getting it into
 * an environment variable turns those into the two characters backslash-n. Putting
 * them back is the single most common Firebase-on-a-host failure, and it fails with
 * an opaque message about an invalid PEM, so it is handled here once rather than
 * being rediscovered at each call site.
 */

import 'server-only';

import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

/** How long a session cookie lasts. Firebase allows up to fourteen days. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function privateKey(): string | undefined {
  const raw = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!raw) return undefined;

  // Some hosts hand it back wrapped in quotes as well.
  const unquoted = raw.replace(/^"(.*)"$/s, '$1');
  return unquoted.replace(/\\n/g, '\n');
}

export function firebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey(),
  );
}

function adminApp(): App {
  if (getApps().length > 0) return getApp();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const key = privateKey();

  if (!projectId || !clientEmail || !key) {
    throw new Error(
      'Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey: key }) });
}

/** Exchanges a freshly minted ID token for a session cookie. */
export async function createSessionCookie(idToken: string): Promise<string> {
  return getAuth(adminApp()).createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
}

/**
 * Checks a session cookie, or returns null.
 *
 * `true` is the second argument, and it is the reason this design was worth choosing
 * over a plain signed token: it checks revocation on every call. Disabling somebody
 * in the Firebase console, or revoking their tokens when an administrator removes
 * them, takes effect on their next request rather than whenever the cookie happens
 * to expire.
 */
export async function verifySessionCookie(cookie: string): Promise<DecodedIdToken | null> {
  try {
    return await getAuth(adminApp()).verifySessionCookie(cookie, true);
  } catch {
    // Expired, revoked, tampered with, or minted by another project. All of them
    // mean the same thing here: nobody is signed in.
    return null;
  }
}

/** Ends every session that person has, everywhere. */
export async function revokeSessions(uid: string): Promise<void> {
  await getAuth(adminApp()).revokeRefreshTokens(uid);
}

/**
 * Creates an account, server-side.
 *
 * Deliberately not `createUserWithEmailAndPassword` in the browser. That call goes
 * straight from the page to Firebase with nothing but the public API key, so it is
 * open to anybody who reads the bundle: it cannot be made to require an invitation,
 * because no code of ours is in the path. Creating accounts here means an invitation
 * is checked first, and the password rules are enforced by something a determined
 * person cannot skip.
 *
 * Firebase stores the password itself, scrypt-hashed. It never reaches this app's
 * storage and is never logged.
 */
export async function createAccount(
  email: string,
  password: string,
  name?: string,
): Promise<string> {
  const user = await getAuth(adminApp()).createUser({
    email,
    password,
    displayName: name || undefined,
    // The invitation was sent to this address and opened from it, which is the same
    // evidence a verification email would produce, one round trip earlier.
    emailVerified: true,
  });
  return user.uid;
}

export async function findAccountByEmail(email: string): Promise<string | null> {
  try {
    return (await getAuth(adminApp()).getUserByEmail(email)).uid;
  } catch {
    return null;
  }
}

/** Used by an administrator resetting somebody who cannot get in. */
export async function setAccountPassword(uid: string, password: string): Promise<void> {
  await getAuth(adminApp()).updateUser(uid, { password });
  // Every existing session ends, which is the point of a reset.
  await getAuth(adminApp()).revokeRefreshTokens(uid);
}

/** Sets the role claim, so an authorisation check costs no database round trip. */
export async function setRoleClaim(uid: string, role: 'admin' | 'trainee'): Promise<void> {
  await getAuth(adminApp()).setCustomUserClaims(uid, { role });
}
