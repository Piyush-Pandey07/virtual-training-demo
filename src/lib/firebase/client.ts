'use client';

/**
 * Firebase in the browser, for signing in and nothing else.
 *
 * The values here are public by design: they identify the project, they are shipped
 * to every visitor in the bundle whatever we do, and Firebase's own documentation
 * hands them out in a snippet meant to be pasted into a web page. What actually
 * protects the project is the authorised-domain list, the provider configuration,
 * and the server-side check every request goes through — not the secrecy of an
 * `apiKey` that was never secret.
 *
 * They come from the environment rather than being written in, so a preview
 * deployment can point at a separate project without a code change. The service
 * account, which *is* secret, lives on the server and never comes near this file.
 *
 * Analytics is deliberately not initialised. It would load a second SDK, set
 * tracking cookies, and send an employee's behaviour on internal compliance training
 * to Google, none of which this needs.
 */

import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, OAuthProvider, signInWithPopup, type Auth } from 'firebase/auth';

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
 * Signs in with the company Microsoft account and returns the ID token.
 *
 * The token is not what the app trusts. It lasts an hour, lives in JavaScript, and
 * would not exist at all during a server render. It is posted once to
 * `/api/auth/session`, which verifies it and swaps it for an httpOnly session cookie
 * that every later request is checked against.
 */
export async function signInWithMicrosoft(tenantId?: string): Promise<string> {
  const provider = new OAuthProvider('microsoft.com');

  // Scoped to the tenant when one is configured, so the Microsoft account picker
  // does not even offer a personal account. The server checks the tenant again on
  // the way in; this is the half that makes the refusal not happen in the first place.
  provider.setCustomParameters({
    prompt: 'select_account',
    ...(tenantId ? { tenant: tenantId } : {}),
  });

  const credential = await signInWithPopup(auth(), provider);
  return credential.user.getIdToken();
}

/** Ends the browser-side session. The server cookie is cleared separately. */
export async function signOutOfFirebase(): Promise<void> {
  if (!firebaseClientConfigured()) return;
  await auth().signOut();
}
