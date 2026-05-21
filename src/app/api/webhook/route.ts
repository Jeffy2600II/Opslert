// Path:    src/app/api/webhook/route.ts  (Opslert bot)
// Purpose: LINE webhook endpoint.
//          • Verifies signature on every request
//          • Handles postback events: when a member presses "✅ ดำเนินการแล้ว"
//            button in the LINE group:
//              1. Gets the member's display name
//              2. Updates the existing Flex Message via PATCH (no quota)
//              3. Notifies YPLABS to update web status
//          • All other event types are silently acknowledged (bot is outbound-only)
// Used by: LINE Platform → Webhook URL

import { NextRequest, NextResponse } from 'next/server';
import { verifyLineSignature, buildResolvedFlex, updateMessage, getMemberName } from '@/lib/line';
import { getReport, deleteReport, resolveModuleLabel } from '@/lib/botStore';
import { assertLineConfig } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/webhook');

export const dynamic = 'force-dynamic';

// ── Notify YPLABS web status ───────────────────────────────────────
// Called after postback resolve so the hub page also reflects "done".
// Uses the same WEBHOOK_SECRET for auth (both sides share it).
// Non-fatal — if YPLABS is unreachable, LINE message is still updated.

async function notifyYplabsResolved(opts: {
  reportId:     string;
  resolvedBy:   string;
  resolvedNote: string | null;
}): Promise<void> {
  const yplabsUrl = process.env.YPLABS_URL;
  const secret    = process.env.WEBHOOK_SECRET;
  if (!yplabsUrl || !secret) return;

  try {
    await fetch(`${yplabsUrl.replace(/\/$/, '')}/api/opslert/report`, {
      method: 'PATCH',
      headers: {
        'Content-Type':    'application/json',
        'X-Bot-Secret':    secret,   // YPLABS PATCH handler accepts this instead of member JWT
      },
      body: JSON.stringify({
        id:           opts.reportId,
        resolvedBy:   opts.resolvedBy,
        resolvedNote: opts.resolvedNote,
        fromBot:      true,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    logger.warn('notifyYplabs failed (non-fatal) — web may show stale status until refresh');
  }
}

// ── Body reader ────────────────────────────────────────────────────

async function readRawBody(req: NextRequest): Promise<Buffer> {
  return Buffer.from(await req.arrayBuffer());
}

// ── Route: POST ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  // Validate config
  try { assertLineConfig('api/webhook'); }
  catch (err: unknown) {
    logger.error('Config missing', { error: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 }); // always 200 to LINE
  }

  // Read raw body first — needed for signature verification
  let rawBody: Buffer;
  try { rawBody = await readRawBody(req); }
  catch { return NextResponse.json({ ok: false }, { status: 200 }); }

  // Verify LINE signature
  const sig = req.headers.get('x-line-signature') ?? '';
  if (!verifyLineSignature(rawBody, sig)) {
    logger.authFail('Invalid LINE signature');
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // Parse body
  let body: { events?: unknown[] };
  try { body = JSON.parse(rawBody.toString('utf8')); }
  catch { return NextResponse.json({ ok: true }, { status: 200 }); }

  const events = body?.events ?? [];
  logger.info('Webhook received', { eventCount: events.length });

  for (const ev of events) {
    const event = ev as Record<string, unknown>;
    const type  = String(event.type ?? '');

    // ── Handle postback ────────────────────────────────────────────
    if (type === 'postback') {
      const postbackData = String((event.postback as any)?.data ?? '');
      const params       = new URLSearchParams(postbackData);
      const action       = params.get('action');
      const reportId     = params.get('reportId');

      logger.debug('Postback received', { action, reportId: reportId?.slice(-8) });

      if (action === 'resolve' && reportId) {
        const source  = event.source as Record<string, string> | undefined;
        const userId  = source?.userId  ?? '';
        const groupId = source?.groupId ?? '';

        // 1. Get display name of member who pressed the button
        const resolvedBy = userId && groupId
          ? await getMemberName(groupId, userId)
          : 'สมาชิกสภา';

        // 2. Look up the stored messageId for this report
        const stored = getReport(reportId);

        if (stored) {
          // 3. Update the existing LINE message — PATCH, no quota cost
          const flex = buildResolvedFlex({
            moduleLabel:  stored.moduleLabel,
            location:     stored.location,
            resolvedBy,
            resolvedNote: null,
          });

          try {
            await updateMessage(stored.messageId, flex);
            logger.info('Message updated via postback', {
              messageId:  stored.messageId.slice(-8),
              resolvedBy,
            });
            deleteReport(reportId); // clean up
          } catch (err: unknown) {
            logger.error('updateMessage via postback failed', { error: String(err) });
            // Continue — still notify YPLABS even if LINE update fails
          }
        } else {
          logger.warn('No stored messageId for reportId (possible cold start)', {
            reportId: reportId.slice(-8),
          });
        }

        // 4. Notify YPLABS to update web status (non-fatal)
        void notifyYplabsResolved({ reportId, resolvedBy, resolvedNote: null });
      }
    }

    // All other event types: silently acknowledge (bot is outbound-only by design)
    if (type !== 'postback') {
      const source = (event.source as Record<string, string> | undefined)?.type ?? 'unknown';
      logger.debug('Non-postback event ignored', { type, source });
    }
  }

  // LINE requires 200 within 30 seconds
  return NextResponse.json({ ok: true }, { status: 200 });
}