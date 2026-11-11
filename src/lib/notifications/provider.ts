/**
 * Who sends the email, behind one small interface (AI-35).
 *
 * Resend, called with `fetch` against its REST API rather than through its SDK: one
 * POST is all this needs, and a dependency for one POST is a dependency to keep up to
 * date for nothing. The interface is there so the tests can stand in for it, and so a
 * second provider would be a new file rather than a change to the outbox.
 *
 * What matters most here is telling a failure worth retrying from one that is not. A
 * network error, a 429 and a 5xx may clear by themselves, so they are retried. Any other
 * 4xx is Resend refusing what was asked, a bad key or a sender on an unverified domain,
 * and asking again would be refused again, so it fails at once and the administrator is
 * told. The one 4xx retried besides 429 is Resend's own "the same request is already in
 * progress" conflict, which its documentation says to retry.
 */

import 'server-only';

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** The same for every try of one notification, so Resend sends it once. */
  idempotencyKey: string;
}

/**
 * The kinds the developer log and the administrator's banner already know (AI-11), and
 * the transient ones. `out_of_credit`, `bad_key` and `not_configured` raise the banner.
 */
export type SendFailureKind =
  | 'connection'
  | 'busy'
  | 'unavailable'
  | 'out_of_credit'
  | 'bad_key'
  | 'not_configured'
  | 'rejected';

export type SendOutcome =
  | { ok: true; providerId: string | null }
  | {
      ok: false;
      retry: boolean;
      kind: SendFailureKind;
      status?: number;
      /** The provider's own words, for the outbox and the developer log. Capped. */
      detail: string;
    };

export interface EmailProvider {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendOutcome>;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** How long one send may take before it counts as a dropped connection. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * What a failed Resend response means.
 *
 * Pure, so it can be tested on recorded bodies. Resend answers errors as
 * `{ statusCode, name, message }`; the name is trusted first and the status second, as
 * its error reference lists them.
 */
export function classifyResendFailure(
  status: number,
  body: { name?: unknown; message?: unknown } | null,
): Extract<SendOutcome, { ok: false }> {
  const name = typeof body?.name === 'string' ? body.name : '';
  const message = typeof body?.message === 'string' ? body.message : '';
  const detail = `Resend ${status}${name ? ` ${name}` : ''}: ${message || 'no message'}`.slice(
    0,
    1000,
  );

  if (status === 429) {
    // Out of the day's or the month's allowance is worth the banner: the daily one
    // clears at midnight UTC, the monthly one needs somebody to act. Retried either way.
    const quota = /quota/i.test(name) || /quota/i.test(message);
    return { ok: false, retry: true, kind: quota ? 'out_of_credit' : 'busy', status, detail };
  }
  if (status >= 500) return { ok: false, retry: true, kind: 'unavailable', status, detail };
  if (status === 409 && name === 'concurrent_idempotent_requests') {
    return { ok: false, retry: true, kind: 'busy', status, detail };
  }
  if (
    status === 401 ||
    /api[_ ]key/i.test(name) ||
    /api key/i.test(message) ||
    name === 'invalid_permission'
  ) {
    return { ok: false, retry: false, kind: 'bad_key', status, detail };
  }
  if (status === 403) {
    // An unverified sender domain, or testing mode, which delivers only to the
    // account owner's own address until a domain is verified. Setup, not a fault.
    return { ok: false, retry: false, kind: 'not_configured', status, detail };
  }
  return { ok: false, retry: false, kind: 'rejected', status, detail };
}

/** Resend, through its REST API. `fetchImpl` is for the tests. */
export function resendProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EmailProvider {
  return {
    name: 'resend',
    async send(email) {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Resend keeps a key for 24 hours, so a retry inside that window of a send
            // whose answer was lost does not send it twice.
            'Idempotency-Key': email.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: email.from,
            to: email.to,
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (error) {
        return {
          ok: false,
          retry: true,
          kind: 'connection',
          detail: `Could not reach Resend: ${(error as Error)?.message ?? String(error)}`.slice(
            0,
            1000,
          ),
        };
      }

      const body = (await response.json().catch(() => null)) as {
        id?: unknown;
        name?: unknown;
        message?: unknown;
      } | null;
      if (response.ok) {
        return { ok: true, providerId: typeof body?.id === 'string' ? body.id : null };
      }
      return classifyResendFailure(response.status, body);
    },
  };
}
