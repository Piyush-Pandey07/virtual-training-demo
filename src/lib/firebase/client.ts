'use client';

/**
 * Firebase in the browser, for signing in and nothing else.
 *
 * The values here are public by design: they identify the project, they are shipped
 * to every visitor in the bundle whatever we do, and Firebase's own documentation
 * hands them out in a snippet meant to be pasted into a web page. What protects the
 * project is the authorised-domain list and the server-side check every request goes
 * through, not the secrecy of an `apiKey` that was never secret.
 *
 * Note what is *not* here: creating an account. That call goes straight from the page
 * to Firebase with nothing but the public key, so it could not be made to require an
 * invitation. Accounts are created on the server, and this file only signs in to one
 * that already exists.
 *
 * Analytics is deliberately not initialised. It would load a second SDK, set tracking
 * cookies, and send an employee's behaviour on internal compliance training to
 * Google, none of which this needs.
 */

import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Whether the browser half is configured. The sign-in page says so when it is not. */
export function firebaseClientConfigured(): boolean {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

function app(): FirebaseApp {
  if (!firebaseClientConfigured()) {
    throw new Error('Firebase is not configured in this browser build.');
  }
  // Next remounts components in development, and initialising twice throws.
  return getApps().length > 0 ? getApp() : initializeApp(config as Required<typeof config>);
}

function auth(): Auth {
  return getAuth(app());
}

/**
 * Signs in and returns the ID token.
 *
 * The token is not what the app trusts afterwards. It lasts an hour, lives in
 * JavaScript, and would not exist during a server render. It is posted once to
 * `/api/auth/session`, which verifies it and swaps it for an httpOnly session cookie
 * that every later request is checked against.
 */
export async function signInWithPassword(email: string, password: string): Promise<string> {
  const credential = await signInWithEmailAndPassword(auth(), email.trim(), password);
  return credential.user.getIdToken();
}

/**
 * Sends a reset email, and says nothing about whether the address is known.
 *
 * Firebase throws `auth/user-not-found` for an unknown address. Passing that through
 * would turn this form into a way of asking which of a list of addresses have
 * accounts here, so it is swallowed and the page says the same thing either way.
 */
export async function sendReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth(), email.trim());
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/user-not-found' || code === 'auth/invalid-email') return;
    throw error;
  }
}

/** Ends the browser-side session. The server cookie is cleared separately. */
export async function signOutOfFirebase(): Promise<void> {
  if (!firebaseClientConfigured()) return;
  const { signOut } = await import('firebase/auth');
  await signOut(auth());
}

/** Turns a Firebase error code into something worth showing somebody. */
export function explainAuthError(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // One message for all three on purpose: telling somebody the address exists
      // but the password is wrong is telling them half of a credential.
      return 'That email address and password do not match.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/user-disabled':
      return 'That account has been disabled. Ask whoever runs your training.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.';
    default:
      return 'Sign-in failed. Try again.';
  }
}
