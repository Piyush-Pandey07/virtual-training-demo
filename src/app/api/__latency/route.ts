/**
 * TEMPORARY. Times a minimal Gemini call from inside the function, to find out whether
 * the trainer's six-to-eleven second first token is the model, the region, or us.
 * Delete once the question is answered.
 */
import { GoogleGenAI } from '@google/genai';

import { GEMINI_MODEL, requireEnv } from '@/lib/config';
import { checkAdmin } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const gate = await checkAdmin();
  if (!gate.ok) return gate.response;

  const ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  const runs: Record<string, number>[] = [];

  for (let i = 0; i < 3; i++) {
    // Tiny prompt, so anything slow is the round trip rather than the work.
    const t0 = Date.now();
    const stream = await ai.models.generateContentStream({
      model: GEMINI_MODEL(),
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
      config: { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } },
    });
    const opened = Date.now() - t0;
    let first = 0;
    for await (const chunk of stream) {
      if (chunk.text && !first) first = Date.now() - t0;
    }
    runs.push({ streamOpened: opened, firstToken: first, total: Date.now() - t0 });
  }

  return Response.json({ region: process.env.VERCEL_REGION ?? 'local', model: GEMINI_MODEL(), runs });
}
