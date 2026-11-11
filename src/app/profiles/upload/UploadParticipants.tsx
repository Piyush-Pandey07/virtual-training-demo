'use client';

/**
 * Choosing a file, sending it, and showing what happened to each row.
 *
 * The file goes to the server as it is. The size is checked here only to save somebody
 * the wait for a refusal; everything that matters is checked on the server.
 */

import { useId, useState } from 'react';

import { uploadParticipants, type UploadReply } from '@/lib/profiles/client';

const STATUS_LABEL = { created: 'Created', updated: 'Updated', rejected: 'Rejected' } as const;

export function UploadParticipants({ maxBytes }: { maxBytes: number }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<UploadReply | null>(null);

  const send = async () => {
    if (!file) return;
    if (file.size > maxBytes) {
      setReply({
        ok: false,
        error: `The file is larger than ${Math.round(maxBytes / 1024)} KB. Split it.`,
      });
      return;
    }
    setBusy(true);
    setReply(null);
    setReply(await uploadParticipants(file));
    setBusy(false);
  };

  return (
    <section className="border-charcoal-line bg-charcoal-soft mt-6 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Upload the filled-in file</h2>
      <label htmlFor={`${id}-file`} className="text-muted mt-3 block text-sm">
        CSV file
      </label>
      <input
        id={`${id}-file`}
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setReply(null);
        }}
        className="text-mist mt-2 block w-full text-sm"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy || !file}
        className="bg-azure text-mist hover:bg-teal hover:text-charcoal mt-4 rounded-md px-6 py-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Uploading' : 'Upload'}
      </button>

      {reply && !reply.ok && (
        <p role="alert" className="text-logo-red mt-4 text-sm">
          {reply.error}
        </p>
      )}

      {reply?.ok && (
        <div className="mt-6" role="status">
          <p className="text-sm">
            {reply.summary.created} created, {reply.summary.updated} updated,{' '}
            {reply.summary.rejected} rejected.
            {reply.summary.incomplete > 0 &&
              ` ${reply.summary.incomplete} will be asked to complete required fields on their first visit.`}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Row</th>
                  <th className="py-2 pr-4 font-semibold">Email</th>
                  <th className="py-2 pr-4 font-semibold">Result</th>
                  <th className="py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {reply.results.map((result) => (
                  <tr key={result.line} className="border-charcoal-line border-t align-top">
                    <td className="py-2 pr-4">{result.line}</td>
                    <td className="py-2 pr-4 break-all">{result.email || '(none)'}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${result.status === 'rejected' ? 'text-logo-red' : 'text-teal'}`}
                    >
                      {STATUS_LABEL[result.status]}
                    </td>
                    <td className="text-muted py-2">
                      {result.status === 'rejected'
                        ? result.reason
                        : result.profile === 'kept'
                          ? 'They have already confirmed their own profile, so it was left as it is.'
                          : result.missing && result.missing.length > 0
                            ? `Profile prefilled. They will be asked for: ${result.missing.join(', ').toLowerCase()}.`
                            : 'Profile prefilled. They will confirm it on their first visit.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
