/**
 * What counts as an acronym or a code in the glossary.
 *
 * On its own, free of imports, because both the matcher and the administrator's form ask
 * it, and the form runs in the browser, where the matcher, which carries the whole
 * imported glossary, must not.
 */

/**
 * Written like an acronym or a code: UPS, RDHx, N+1, 2N, FM-200, D2C, HV/MV.
 *
 * Matched as written, case-sensitively and as a whole token, where anything else is
 * matched as a name in any case. The slash is for a pair the trade writes as one code,
 * such as HV/MV for high and medium voltage. No imported entry has one, so allowing it
 * changed nothing the imported glossary matches.
 */
export function writtenAsCode(text: string): boolean {
  return (
    /^[A-Z0-9][A-Za-z0-9&+/-]{0,9}$/.test(text) && /[A-Z]/.test(text) && /[A-Z0-9]{2}|\+/.test(text)
  );
}

/**
 * Acronyms that mean something else in this glossary's own definitions: direct current
 * and the data centre, information technology, the N of N+1, alternating current. An
 * entry with one of these as its acronym would match far more than it defines.
 */
export const AMBIGUOUS_ACRONYMS: readonly string[] = ['DC', 'IT', 'N', 'AC'];
