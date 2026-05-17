// Path:    src/app/api/webhook/route.ts
// Purpose: LINE webhook endpoint — verifies signature and acknowledges events.
//          The bot does NOT reply to any user messages (intentional design).
//          All alerts flow outbound only via /api/receive.
// Used by: LINE Platform → set Webhook URL to https://opslert.vercel.app/api/webhook

import { NextRequest, NextResponse } from 'next/server';
import { verifyLineSignature } from '@/lib/line';
import { assertLineConfig } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/webhook');

// บังคับให้ Route นี้ทำงานแบบ Dynamic เสมอ (ป้องกันการทำ Static Optimize ตอน Build)
export const dynamic = 'force-dynamic';

// ── Raw body reader (ปรับปรุงสำหรับ App Router) ───────────────────

async function readRawBody(req: NextRequest): Promise < Buffer > {
  const arrayBuffer = await req.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Route handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise < NextResponse > {
  logger.request('POST');
  
  // Validate env config
  try {
    assertLineConfig('api/webhook');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Config error';
    logger.error('Missing LINE config', { error: msg });
    // Return 200 to LINE anyway — they retry on non-2xx
    return NextResponse.json({ ok: false, error: 'Misconfigured' }, { status: 200 });
  }
  
  // Read raw body before any parsing — required for HMAC verification
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err: unknown) {
    logger.error('Failed to read request body', { error: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  
  // Verify LINE signature
  const signature = req.headers.get('x-line-signature') ?? '';
  if (!verifyLineSignature(rawBody, signature)) {
    logger.authFail('Invalid LINE signature');
    // Return 200 — LINE treats 401 as a webhook failure and retries
    // Logging the failure is sufficient; we don't want retry loops
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 200 });
  }
  
  // Parse body
  let body: { events ? : unknown[] };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn('Failed to parse webhook JSON');
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  
  const events = body?.events ?? [];
  logger.info('Webhook received', { eventCount: events.length });
  
  // Log event types for observability — but intentionally do NOT reply
  for (const ev of events) {
    const event = ev as Record < string,
      unknown > ;
    const type = event.type as string ?? 'unknown';
    const src = (event.source as Record < string, string > )?.type ?? 'unknown';
    
    logger.debug('Event', { type, source: src });
    
    // ⚠️ By design: no reply to any event.
    // The bot is outbound-only — it sends alerts, never responds.
    // If reply logic is needed in the future, add it here.
  }
  
  // LINE requires a 200 response within 30 seconds
  return NextResponse.json({ ok: true }, { status: 200 });
}