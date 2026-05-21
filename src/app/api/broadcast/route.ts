// Path:    src/app/api/broadcast/route.ts  (Opslert bot)
// Purpose: Called by YPLABS when council marks a report as resolved.
//          Uses LINE PATCH /v2/bot/message/{messageId} to UPDATE the existing
//          Flex Message in place — header turns green, button removed.
//          Does NOT send a new message → does NOT consume push quota.
// Auth:    X-Webhook-Secret (same WEBHOOK_SECRET as /api/receive)
// Used by: YPLABS → src/app/api/opslert/report/route.ts (PATCH)

import { NextRequest, NextResponse } from 'next/server';
import { buildResolvedFlex, updateMessage } from '@/lib/line';
import { deleteReport, resolveModuleLabel } from '@/lib/botStore';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const logger = createLogger('api/broadcast');

// ── Secret verification ───────────────────────────────────────────

function verifySecret(incoming: string): boolean {
  const expected = process.env.WEBHOOK_SECRET ?? '';
  if (!expected || !incoming) return false;
  try {
    const key = 'opslert-broadcast';
    const ha  = crypto.createHmac('sha256', key).update(incoming).digest();
    const hb  = crypto.createHmac('sha256', key).update(expected).digest();
    return crypto.timingSafeEqual(ha, hb);
  } catch { return false; }
}

// ── Rate limit ────────────────────────────────────────────────────

const rlMap = new Map<string, { count: number; resetAt: number }>();

function checkLimit(ip: string): boolean {
  const now = Date.now();
  let e = rlMap.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; rlMap.set(ip, e); }
  if (e.count >= 30) return false;
  e.count++;
  return true;
}

// ── Route: POST ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  const secret = req.headers.get('x-webhook-secret') ?? '';
  if (!verifySecret(secret)) {
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

  const b = body as Record<string, unknown>;
  const messageId   = String(b.messageId   ?? '').trim();
  const reportId    = String(b.reportId    ?? '').trim();
  const reportType  = String(b.reportType  ?? '').trim();
  const location    = String(b.location    ?? '').trim();
  const resolvedBy  = String(b.resolvedBy  ?? 'สมาชิกสภา').trim();
  const resolvedNote = b.resolvedNote ? String(b.resolvedNote).trim().slice(0, 200) : null;

  if (!messageId) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
  }

  const moduleLabel = resolveModuleLabel(reportType);

  // Build resolved Flex (no button, green header)
  const flex = buildResolvedFlex({ moduleLabel, location, resolvedBy, resolvedNote });

  // PATCH existing message — FREE, no quota consumed
  try {
    await updateMessage(messageId, flex);
    logger.info('Message updated to resolved', {
      messageId: messageId.slice(-8),
      resolvedBy,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('updateMessage failed', { error: msg, messageId: messageId.slice(-8) });
    // Return error so YPLABS knows LINE update failed (web status was already updated)
    return NextResponse.json({ error: `LINE update failed: ${msg}` }, { status: 502 });
  }

  // Clean up bot store entry (no longer needed)
  if (reportId) deleteReport(reportId);

  return NextResponse.json({ ok: true });
}