/**
 * Text as it arrives from a browser, reduced to what a person can actually read.
 *
 * Everything an upload carries -- slide lines, the title hint, speaker notes -- comes
 * through here, because all of it is extracted from a file rather than typed, and
 * extraction leaves debris that looks like text and is not.
 *
 * The one that costs something is the non-breaking space. It survives every stage,
 * renders as a space, and is not one: "data\u00A0classification" is a single token to
 * anything that splits on spaces, so the topic never matches the question and the deck
 * quietly stops navigating. That failure has no symptom to search for. The rest --
 * unmappable glyphs from a font with no ToUnicode table, zero-width joiners and
 * byte-order marks picked up from copied text, control characters -- are cheaper to
 * strip here than to explain later.
 *
 * What this deliberately does not do is correct the deck. A title reading
 * "ISMS -Awareness Session" was assumed to be damage from PDF extraction and was not:
 * the PowerPoint says exactly that, missing space and all. Extraction was faithful and
 * the author was not, which is the author's to fix. Guessing where a space belongs
 * would put this code in the business of rewriting slides it does not understand.
 */

export function readable(text: string): string {
  return (
    text
      // Unmappable glyphs and the invisibles: replacement character, soft hyphen,
      // zero-width space through right-to-left mark, word joiner, byte-order mark.
      .replace(/[\uFFFD\u00AD\u200B-\u200F\u2060\uFEFF]/g, '')
      // Spaces that are not the space key: non-breaking, en quad through hair space,
      // narrow no-break, and the control characters no line should carry.
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
