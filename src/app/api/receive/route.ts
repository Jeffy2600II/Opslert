// Path:    src/app/api/receive/route.ts
// Purpose: Receives validated alert payload from YPLABS, authenticates via
//          shared secret, then sends a formatted message to the LINE group.
//          This is the core integration point between YPLABS and Opslert.
// Used by: YPLABS → src/app/api/opslert/report/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { assertLineConfig, assertWebhookConfig, WEBHOOK_SECRET } from '@/lib/env';
import { buildAlertMessage, sendGroupMessage } from '@/lib/line';
import { checkRateLimit } from '@/lib/rateLimit';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/receive');

// ── Input types ───────────────────────────────────────────────────

type AlertLevel  = 'almost_empty' | 'empty';
type ReportType  = 'paper';

type IncomingPayload = {
  reportType: ReportType;
  alertLevel: AlertLevel;
  location:   string;
  note?:      string;
};

// ── Validation ────────────────────────────────────────────────────

const VALID_REPORT_TYPES: ReadonlySet<string> = new Set(['paper']);
const VALID_ALERT_LEVELS: ReadonlySet<string> = new Set(['almost_empty', 'empty']);

function validatePayload(body: unknown): IncomingPayload | null {
  if (!body || typeof body !== 'object') return null;

  const b = body as Record<string, unknown>;
  const reportType = String(b.reportType ?? '').trim();
  const alertLevel = String(b.alertLevel ?? '').trim();
  const location   = String(b.location   ?? '').trim();
  const note       = String(b.note       ?? '').trim().slice(0, 200);

  if (!VALID_REPORT_TYPES.has(reportType)) return null;
  if (!VALID_ALERT_LEVELS.has(alertLevel)) return null;
  if (!location || location.length > 100)  return null;

  return {
    reportType: reportType as ReportType,
    alertLevel: alertLevel as AlertLevel,
    location,
    note: note || undefined,
  };
}

// ── Auth: constant-time shared secret check ───────────────────────

import crypto from 'crypto';

function verifyWebhookSecret(incoming: string): boolean {
  const expected = WEBHOOK_SECRET;
  if (!expected || !incoming) return false;
  try {
    // Normalize to same length via HMAC before timingSafeEqual
    const key = 'opslert-secret-compare';
    const ha = crypto.createHmac('sha256', key).update(incoming).digest();
    const hb = crypto.createHmac('sha256', key).update(expected).digest();
    return crypto.timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

// ── Route handler ─────────────────────────────────────────────────

// Rate limit: 30 requests per minute from any single IP
// The YPLABS server is the only caller so this is generous
const RATE_LIMIT_CONFIG = { max: 30, windowMs: 60 * 1000 };

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  // Validate env config before processing anything
  try {
    assertLineConfig('api/receive');
    assertWebhookConfig('api/receive');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Config error';
    logger.error('Missing env config', { error: msg });
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 });
  }

  // Rate limiting by IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = checkRateLimit('receive', ip, RATE_LIMIT_CONFIG);

  if (!rl.allowed) {
    logger.warn('Rate limited', { ip: ip.slice(-8) });
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // Auth: verify shared secret from X-Webhook-Secret header
  const incomingSecret = req.headers.get('x-webhook-secret') ?? '';
  if (!verifyWebhookSecret(incomingSecret)) {
    logger.authFail('Invalid webhook secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const payload = validatePayload(body);
  if (!payload) {
    logger.warn('Invalid payload', { body: JSON.stringify(body).slice(0, 100) });
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  logger.info('Alert received', {
    type:  payload.reportType,
    level: payload.alertLevel,
    loc:   payload.location,
  });

  // Build message and send to LINE group
  try {
    const message = buildAlertMessage(payload);
    await sendGroupMessage(message);
    logger.info('LINE message sent', { groupId: process.env.LINE_GROUP_ID?.slice(-8) });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to send LINE message', { error: msg });
    return NextResponse.json(
      { error: 'Failed to send LINE message' },
      { status: 502 }
    );
  }
}