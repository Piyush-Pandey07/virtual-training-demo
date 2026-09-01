/**
 * What a customer has spent this month.
 *
 * Not a bill. These are the quantities the bill is made of — characters spoken,
 * seconds listened to, tokens thought — recorded where they are actually spent, so
 * that what a customer costs can be answered from data rather than from an estimate.
 *
 * Prices are deliberately absent. They change, they differ per contract, and a number
 * stored in a database with a price already applied is a number nobody can re-derive
 * when the price moves. Multiply at the point of asking.
 */

export interface Usage {
  orgId: string;
  /** `YYYY-MM`, in UTC. Also this document's id. */
  month: string;

  /**
   * Characters sent to text-to-speech.
   *
   * The largest line on the bill by some distance: roughly two thirds of what a
   * session costs is the trainer talking.
   */
  ttsCharacters: number;

  /** Seconds of audio sent to speech-to-text. */
  sttSeconds: number;

  geminiInputTokens: number;
  geminiOutputTokens: number;

  /**
   * Sessions begun this month, which is what a cap is expressed in.
   *
   * Counted when a session's first narration is asked for. Somebody who abandons a
   * session and starts again counts twice, which is correct: it is twice the spend.
   */
  sessions: number;

  /** Decks analysed. A one-off per deck, and tiny, but worth seeing separately. */
  decksAnalysed: number;

  updatedAt: string;
}

/** Everything a caller may add to a month. All optional; absent means zero. */
export type UsageDelta = Partial<
  Pick<
    Usage,
    | 'ttsCharacters'
    | 'sttSeconds'
    | 'geminiInputTokens'
    | 'geminiOutputTokens'
    | 'sessions'
    | 'decksAnalysed'
  >
>;

/** The month a moment falls in, in UTC. */
export function monthOf(when: Date): string {
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function emptyUsage(orgId: string, month: string, now: string): Usage {
  return {
    orgId,
    month,
    ttsCharacters: 0,
    sttSeconds: 0,
    geminiInputTokens: 0,
    geminiOutputTokens: 0,
    sessions: 0,
    decksAnalysed: 0,
    updatedAt: now,
  };
}
