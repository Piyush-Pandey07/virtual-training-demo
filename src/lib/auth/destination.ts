/**
 * Where to send somebody once they have signed in.
 *
 * `next` arrives in a query string, so anybody can write it, and it is followed straight
 * after a successful sign-in, which is the moment a person trusts the page most. A link
 * to the genuine sign-in page that ends on somebody else's site is the whole of a
 * phishing attack: the victim types their real password into the real page, and is then
 * handed to a copy that says the session expired.
 *
 * The check this replaced was `startsWith('/') && !startsWith('//')`, which reads like
 * enough and is not. URL parsers treat a backslash in a web address as a forward slash,
 * and strip tabs and newlines before they parse, so all of these passed it and all of
 * them landed on another site, verified in Chromium against the live sign-in page:
 *
 *     /\evil.com        /<tab>/evil.com        /<newline>/evil.com
 *
 * The flaw was checking one string and following another: the check read the raw text,
 * and the browser followed its own interpretation of it. So this asks the parser, and
 * then returns what the parser produced, so the thing checked and the thing followed
 * are the same thing.
 */

/** Any fixed origin will do. It never reaches a network, it is only compared against. */
const HERE = 'https://destination.invalid';

/**
 * A path on this site to go to after sign-in, or `/` if `next` is missing or points
 * anywhere else.
 */
export function safeDestination(next: string | null | undefined): string {
  if (!next) return '/';

  let parsed: URL;
  try {
    parsed = new URL(next, HERE);
  } catch {
    return '/';
  }
  if (parsed.origin !== HERE) return '/';

  const destination = parsed.pathname + parsed.search + parsed.hash;

  // The parser's normal form, checked again rather than trusted. `/.//evil.com` parses
  // as a path on this origin, and normalises to `//evil.com`, which is not one.
  return new URL(destination, HERE).origin === HERE ? destination : '/';
}
