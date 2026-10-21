import type { NextConfig } from 'next';

/**
 * What a page may load and talk to, and who may frame it.
 *
 * Only HSTS was set before, by Vercel. The policy names exactly what the browser really
 * reaches: this site, Deepgram's live transcription socket, and Firebase's sign-in
 * services. Everything else, including any script injected from somewhere else, is
 * refused, and no other site may put these pages in a frame.
 *
 * Scripts keep 'unsafe-inline', the Next.js guide's "without nonces" policy. A nonce
 * would force every page to be rendered per request; the strict parts that matter here
 * are the connect, frame and object rules. 'unsafe-eval' is development only, where
 * React needs it for its error overlay.
 */
const isDev = process.env.NODE_ENV === 'development';

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  // Only the OpenAI test page plays from an object URL, to replay what was just
  // recorded. Speech in a session, and a voice sample, is decoded and played through Web
  // Audio, which this directive does not govern.
  "media-src 'self' blob:",
  // The pdf.js worker is copied into this site at build time, so it is same-origin. The
  // microphone worklet is not a worker in this sense: audioWorklet.addModule is checked
  // against script-src.
  "worker-src 'self'",
  // Firebase reCAPTCHA Enterprise, if it were ever enforced for email and password
  // sign-in, would need www.google.com/recaptcha and www.gstatic.com/recaptcha allowed
  // here and in script-src and frame-src. Sign-in works today without them; whether
  // enforcement is on is a project setting, so check it in the Firebase console before
  // turning it on, or sign-in will fail with nothing in this file to say why.
  [
    "connect-src 'self'",
    'wss://api.deepgram.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    ...(isDev ? ['ws:'] : []),
  ].join(' '),
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The microphone is the only device a session needs, and only from this site.
  {
    key: 'Permissions-Policy',
    value: 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
  },
  // Sign-in never opens a popup, so nothing needs a window that keeps a reference
  // back to this one.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Nothing here is meant to be embedded by another site, so other sites may not load
  // it at all, even as an image or a script.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  /**
   * firebase-admin is loaded, not bundled.
   *
   * It resolves parts of itself at run time, which a bundler cannot follow. Bundled,
   * it throws while the module is still being evaluated, so every page that imports
   * it, which is every page behind sign-in, returns a 500 before any of its own
   * code runs. Locally it never showed: the dev server does not bundle server
   * dependencies, so this only appeared once it was deployed.
   */
  serverExternalPackages: ['firebase-admin'],
};

export default nextConfig;
