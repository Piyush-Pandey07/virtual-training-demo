/**
 * Writing a notification's subject, plain text and HTML from one description of it.
 *
 * One description rendered twice, so the plain text and the HTML cannot say different
 * things. The HTML is deliberately plain: paragraphs, a table of facts, a list and a
 * link, readable in any mail client and with nothing to load. Everything that came from
 * a person or a customer is escaped, since a deck title or a name is text somebody typed.
 */

export interface EmailContent {
  subject: string;
  /** The opening paragraph. */
  intro: string;
  /** Label and value pairs, shown as a short table. */
  facts?: [string, string][];
  /** A list under the facts, such as the participants a digest is about. */
  list?: { heading: string; items: string[] };
  link?: { label: string; url: string };
  /** A closing note, such as what happens next. */
  note?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Control characters out, so nothing typed into a name can forge a header or a line. */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

const FOOTER =
  'Sent by Nova, the Technavious training portal. Nobody reads replies to this address.';

export function renderText(content: EmailContent): string {
  const lines = [content.intro, ''];
  for (const [label, value] of content.facts ?? []) lines.push(`${label}: ${value}`);
  if (content.facts?.length) lines.push('');
  if (content.list) {
    lines.push(content.list.heading);
    for (const item of content.list.items) lines.push(`- ${item}`);
    lines.push('');
  }
  if (content.link) lines.push(`${content.link.label}: ${content.link.url}`, '');
  if (content.note) lines.push(content.note, '');
  lines.push('--', FOOTER);
  return lines.join('\n');
}

export function renderHtml(content: EmailContent): string {
  const parts = [`<p>${escapeHtml(content.intro)}</p>`];
  if (content.facts?.length) {
    const rows = content.facts
      .map(
        ([label, value]) =>
          `<tr><th align="left" style="padding:2px 12px 2px 0">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
      )
      .join('');
    parts.push(`<table cellpadding="0" cellspacing="0">${rows}</table>`);
  }
  if (content.list) {
    const items = content.list.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    parts.push(`<p>${escapeHtml(content.list.heading)}</p><ul>${items}</ul>`);
  }
  if (content.link) {
    parts.push(
      `<p><a href="${escapeHtml(content.link.url)}">${escapeHtml(content.link.label)}</a></p>`,
    );
  }
  if (content.note) parts.push(`<p>${escapeHtml(content.note)}</p>`);
  parts.push(`<p style="color:#666;font-size:12px">${escapeHtml(FOOTER)}</p>`);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${parts.join('')}</div>`;
}
