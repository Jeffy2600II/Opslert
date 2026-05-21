// Path:    src/app/api/receive/route.ts  (Opslert bot)
// Purpose: Receives validated alert payload from YPLABS, sends Flex Message
//          to LINE group, stores reportId→messageId mapping for later updates.
//          Returns messageId to YPLABS so it can call /api/broadcast to update
//          the same message when the report is resolved (no quota cost).
// Used by: YPLABS → src/app/api/opslert/report/route.ts (POST)

import { NextRequest, NextResponse } from 'next/server';
import { assertLineConfig, assertWebhookConfig, WEBHOOK_SECRET } from '@/lib/env';
import { buildAlertFlex, sendGroupFlex } from '@/lib/line';
import { setReport, resolveModuleLabel } from '@/lib/botStore';
import { checkRateLimit } from '@/lib/rateLimit';
import { createLogger } from '@/lib/logger';
import crypto from 'crypto';

const logger = createLogger('api/receive');

// ── Types ─────────────────────────────────────────────────────────

type IncomingPayload = {
  reportId:   string; // UUID from YPLABS cache — used as postback data
  reportType: string;
  alertLevel: string;
  location:   string;
  note?:      string;
};

// ── Validation ────────────────────────────────────────────────────

const VALID_REPORT_TYPES = new Set(['paper']);
const VALID_ALERT_LEVELS = new Set(['almost_empty', 'empty']);

function validatePayload(body: unknown): IncomingPayload | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const reportId   = String(b.reportId   ?? '').trim();
  const reportType = String(b.reportType ?? '').trim();
  const alertLevel = String(b.alertLevel ?? '').trim();
  const location   = String(b.location   ?? '').trim();
  const note       = String(b.note       ?? '').trim().slice(0, 200) || undefined;
  if (!reportId)                             return null;
  if (!VALID_REPORT_TYPES.has(reportType))   return null;
  if (!VALID_ALERT_LEVELS.has(alertLevel))   return null;
  if (!location || location.length > 100)    return null;
  return { reportId, reportType, alertLevel, location, note };
}

// ── Secret verification ───────────────────────────────────────────

function verifySecret(incoming: string): boolean {
  const expected = WEBHOOK_SECRET;
  if (!expected || !incoming) return false;
  try {
    const key = 'opslert-receive';
    const ha  = crypto.createHmac('sha256', key).update(incoming).digest();
    const hb  = crypto.createHmac('sha256', key).update(expected).digest();
    return crypto.timingSafeEqual(ha, hb);
  } catch { return false; }
}

// ── Rate limit ────────────────────────────────────────────────────

const RATE_LIMIT = { max: 30, windowMs: 60 * 1000 };

// ── Route: POST ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  try {
    assertLineConfig('api/receive');
    assertWebhookConfig('api/receive');
  } catch (err: unknown) {
    logger.error('Config missing', { error: String(err) });
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 });
  }

  // Auth
  const secret = req.headers.get('x-webhook-secret') ?? '';
  if (!verifySecret(secret)) {
    logger.authFail('Invalid webhook secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit('receive', ip, RATE_LIMIT).allowed) {
    logger.warn('Rate limited', { ip: ip.slice(-8) });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Parse + validate
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const payload = validatePayload(body);
  if (!payload) {
    logger.warn('Invalid payload', { body: JSON.stringify(body).slice(0, 120) });
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const moduleLabel = resolveModuleLabel(payload.reportType);

  logger.info('Alert received', {
    reportId: payload.reportId.slice(-8),
    type:     payload.reportType,
    level:    payload.alertLevel,
    loc:      payload.location,
  });

  // Build Flex Message with postback button
  const flex = buildAlertFlex({
    reportId:    payload.reportId,
    reportType:  payload.reportType,
    moduleLabel,
    alertLevel:  payload.alertLevel,
    location:    payload.location,
    note:        payload.note,
  });

  // Send to LINE group — costs 1 quota
  let messageId: string | null = null;
  try {
    messageId = await sendGroupFlex(flex);
    logger.info('Flex Message sent', { messageId: messageId?.slice(-8), reportId: payload.reportId.slice(-8) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to send Flex Message', { error: msg });
    return NextResponse.json({ error: 'Failed to send LINE message' }, { status: 502 });
  }

  // Store reportId → messageId for later PATCH update (resolve)
  if (messageId) {
    setReport(payload.reportId, {
      messageId,
      reportType:  payload.reportType,
      moduleLabel,
      alertLevel:  payload.alertLevel,
      location:    payload.location,
      note:        payload.note,
    });
  }

  // Return messageId to YPLABS — stored in report cache for resolve call
  return NextResponse.json({ ok: true, messageId });
}