// Path:    src/app/api/broadcast/route.ts  (Opslert bot project)
// Purpose: Receives a pre-built message text from YPLABS and forwards it
//          directly to the LINE group. Simpler than /api/receive — no
//          report-type validation, just raw push.
// Used by: YPLABS → src/app/api/opslert/notify/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSecret } from '@/lib/webhookAuth'; // see note below
import { sendGroupMessage } from '@/lib/line';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/broadcast');

// ── Rate limit (per IP) ────────────────────────────────────────────
const map = new Map<string, { count: number; resetAt: number }>();

function checkLimit(ip: string): boolean {
  const now = Date.now();
  let e = map.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; map.set(ip, e); }
  if (e.count >= 20) return false;
  e.count++;
  return true;
}

// ── Route: POST ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  // Auth — same X-Webhook-Secret header as /api/receive
  const secret = req.headers.get('x-webhook-secret') ?? '';
  const expected = process.env.WEBHOOK_SECRET ?? '';
  if (!expected || secret !== expected) {
    logger.authFail('Invalid webhook secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = String((body as any)?.text ?? '').trim().slice(0, 2000);
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    await sendGroupMessage(text);
    logger.info('broadcast sent', { chars: text.length });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('broadcast failed', { error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}