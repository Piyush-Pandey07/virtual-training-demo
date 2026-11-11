'use client';

/**
 * Search box and checkboxes, for choosing participants out of a long list.
 *
 * Searchable because a group has no set size and UAT tests it with fifty, and with no
 * cap on how many may be chosen: the list scrolls rather than stops.
 */

import { useMemo, useState } from 'react';

export interface PersonOption {
  id: string;
  name: string;
  email: string;
}

const FIELD =
  'bg-charcoal text-mist placeholder:text-muted ring-charcoal-line focus:ring-teal mt-2 w-full rounded-md px-3.5 py-2.5 text-sm ring-1 ring-inset';

export function ParticipantPicker({
  people,
  chosen,
  onChange,
  idPrefix,
  legend = 'Participants',
}: {
  people: PersonOption[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
  legend?: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? people.filter(
          (person) =>
            person.name.toLowerCase().includes(needle) ||
            person.email.toLowerCase().includes(needle),
        )
      : people;
  }, [people, query]);
  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id]);

  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-sm font-semibold">
        {legend} <span className="text-muted ml-2 font-normal">{chosen.length} chosen</span>
      </legend>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or email"
        aria-label={`Search ${legend.toLowerCase()}`}
        className={FIELD}
      />
      <div className="mt-2 flex gap-3 text-xs">
        <button
          type="button"
          className="text-teal hover:underline"
          onClick={() => onChange([...new Set([...chosen, ...shown.map((person) => person.id)])])}
        >
          Choose all shown
        </button>
        <button type="button" className="text-muted hover:underline" onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <ul className="border-charcoal-line mt-2 max-h-64 overflow-y-auto rounded-md border">
        {shown.map((person) => (
          <li key={person.id} className="border-charcoal-line border-b last:border-b-0">
            <label
              htmlFor={`${idPrefix}-${person.id}`}
              className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
            >
              <input
                id={`${idPrefix}-${person.id}`}
                type="checkbox"
                checked={chosen.includes(person.id)}
                onChange={() => toggle(person.id)}
                className="accent-teal size-4 shrink-0"
              />
              <span className="text-mist">{person.name}</span>
              <span className="text-muted truncate text-xs">{person.email}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="text-muted px-3 py-2 text-sm">Nobody matches.</li>}
      </ul>
    </fieldset>
  );
}
