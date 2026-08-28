/**
 * GET /api/diag
 *
 * Temporary. Every page behind sign-in returns a 500 on the deployment while
 * /api/health answers, and a 500 from a module that throws while being evaluated
 * carries no useful trace. This loads each suspect one at a time and reports which
 * one fails, and with what.
 *
 * Deleted as soon as it has answered. It reports no secrets: module names, whether
 * they loaded, and the error message if one did not.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function tryLoad(name: string, load: () => Promise<unknown>) {
  try {
    await load();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: (error as Error).message?.slice(0, 400),
      kind: (error as Error).name,
    };
  }
}

export async function GET() {
  const results = [
    await tryLoad('firebase-admin/app', () => import('firebase-admin/app')),
    await tryLoad('firebase-admin/auth', () => import('firebase-admin/auth')),
    await tryLoad('lib/firebase/admin', () => import('@/lib/firebase/admin')),
    await tryLoad('lib/roster/registry', () => import('@/lib/roster/registry')),
    await tryLoad('lib/roster/store-blob', () => import('@/lib/roster/store-blob')),
    await tryLoad('lib/auth/session', () => import('@/lib/auth/session')),
    await tryLoad('lib/auth/guard', () => import('@/lib/auth/guard')),
  ];

  // And whether the roster store can actually be built and read.
  let roster: unknown;
  try {
    const { rosterStore } = await import('@/lib/roster/registry');
    const store = rosterStore();
    roster = { kind: store.kind, writable: store.writable, people: (await store.listPeople()).length };
  } catch (error) {
    roster = { failed: (error as Error).message?.slice(0, 400) };
  }

  return Response.json({ results, roster }, { headers: { 'Cache-Control': 'no-store' } });
}
