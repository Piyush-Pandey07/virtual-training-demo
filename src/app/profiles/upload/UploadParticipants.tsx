'use client';

/**
 * Choosing a file, sending it, and showing what happened to each row.
 *
 * The file goes to the server as it is. The size is checked here only to save somebody
 * the wait for a refusal; everything that matters is checked on the server.
 */

import { useId, useState } from 'react';

import { uploadParticipants, type UploadReply } from '@/lib/profiles/client';

/** One row's outcome, reached through the client module rather than the server-only one. */
type UploadResult = Extract<UploadReply, { ok: true }>['results'][number];

const STATUS_LABEL: Record<UploadResult['status'], string> = {
  created: 'Created',
  updated: 'Updated',
  duplicate: 'Duplicate',
  rejected: 'Failed',
};

/** One of the three lists AI-28 asks for: imported, duplicates, and failed with why. */
function ResultTable({
  title,
  rows,
  detail,
  empty,
  tone = 'text-mist',
}: {
  title: string;
  rows: UploadResult[];
  detail: (result: UploadResult) => string;
  empty?: string;
  tone?: string;
}) {
  return (
    <section>
      <h3 className={`text-base font-semibold ${tone}`}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted mt-2 text-sm">{empty}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-semibold">Row</th>
                <th className="py-2 pr-4 font-semibold">Email</th>
                <th className="py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((result) => (
                <tr key={result.line} className="border-charcoal-line border-t align-top">
                  <td className="py-2 pr-4">{result.line}</td>
                  <td className="py-2 pr-4 break-all">{result.email || '(none)'}</td>
                  <td className="text-muted py-2">{detail(result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function UploadParticipants({ maxBytes }: { maxBytes: number }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<UploadReply | null>(null);

  const results = reply?.ok ? reply.results : [];
  const imported = results.filter(
    (result) => result.status === 'created' || result.status === 'updated',
  );
  const duplicates = results.filter((result) => result.status === 'duplicate');
  const failed = results.filter((result) => result.status === 'rejected');

  const send = async () => {
    if (!file) return;
    if (file.size > maxBytes) {
      setReply({
        ok: false,
        error: `The file is larger than ${maxBytes / 1_048_576} MB. Split it in two.`,
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
        <div className="mt-6 space-y-8" role="status">
          <p className="text-sm">
            {imported.length} imported ({reply.summary.created} new, {reply.summary.updated} already
            here), {reply.summary.duplicates}{' '}
            {reply.summary.duplicates === 1 ? 'duplicate' : 'duplicates'}, {reply.summary.rejected}{' '}
            failed.
            {reply.summary.incomplete > 0 &&
              ` ${reply.summary.incomplete} will be asked to complete required fields on their first visit.`}
          </p>

          <ResultTable
            title={`Imported (${imported.length})`}
            empty="Nobody was imported."
            rows={imported}
            detail={(result) =>
              `${STATUS_LABEL[result.status]}. ${
                result.profile === 'kept'
                  ? 'They have already confirmed their own profile, so it was left as it is.'
                  : result.missing && result.missing.length > 0
                    ? `Profile prefilled. They will be asked for: ${result.missing.join(', ').toLowerCase()}.`
                    : 'Profile prefilled. They will confirm it on their first visit.'
              }`
            }
          />
          {duplicates.length > 0 && (
            <ResultTable
              title={`Duplicates (${duplicates.length})`}
              rows={duplicates}
              detail={(result) => `Duplicate of row ${result.duplicateOf}, which is the one kept.`}
            />
          )}
          {failed.length > 0 && (
            <ResultTable
              title={`Failed (${failed.length})`}
              tone="text-logo-red"
              rows={failed}
              detail={(result) => result.reason ?? 'Not imported.'}
            />
          )}
        </div>
      )}
    </section>
  );
}
