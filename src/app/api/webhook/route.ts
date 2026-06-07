// Path:    src/app/api/webhook/route.ts  (Opslert bot)
// Purpose: LINE webhook endpoint.
// ─── สิ่งที่เปลี่ยนแปลง ────────────────────────────────────────────────
// - ยังคงทำงานเหมือนเดิม (verify signature, handle postback, update LINE message)
// - แต่ตอน notify YPLABS จะใช้ PATCH /api/opslert/report ทุกครั้ง
//   (ไม่ต้องพึ่งว่า report จะอยู่ใน cache หรือไม่ เพราะตอนนี้ YPLABS ใช้ DB)

import { NextRequest, NextResponse } from 'next/server';
import { verifyLineSignature, buildResolvedFlex, updateMessage, getMemberName } from '@/lib/line';
import { getReport, deleteReport, resolveModuleLabel } from '@/lib/botStore';
import { assertLineConfig } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/webhook');

export const dynamic = 'force-dynamic';

// ── Notify YPLABS web status ───────────────────────────────────────
// เรียก YPLABS API เพื่ออัปเดตสถานะบนเว็บ
// ตอนนี้ YPLABS ใช้ Supabase DB จึงไม่มีปัญหา cold start ทำให้ข้อมูลหาย

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
        'X-Bot-Secret':    secret,
      },
      body: JSON.stringify({
        id:           opts.reportId,
        resolvedBy:   opts.resolvedBy,
        resolvedNote: opts.resolvedNote,
        fromBot:      true,
      }),
      signal: AbortSignal.timeout(10_000), // ✅ เพิ่ม timeout จาก 5s → 10s
    });
  } catch {
    logger.warn('notifyYplabs failed (non-fatal) — web may show stale status until Realtime sync');
  }
}

// ── Body reader ────────────────────────────────────────────────────

async function readRawBody(req: NextRequest): Promise<Buffer> {
  return Buffer.from(await req.arrayBuffer());
}

// ── Route: POST ────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.request('POST');

  try { assertLineConfig('api/webhook'); }
  catch (err: unknown) {
    logger.error('Config missing', { error: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let rawBody: Buffer;
  try { rawBody = await readRawBody(req); }
  catch { return NextResponse.json({ ok: false }, { status: 200 }); }

  const sig = req.headers.get('x-line-signature') ?? '';
  if (!verifyLineSignature(rawBody, sig)) {
    logger.authFail('Invalid LINE signature');
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  let body: { events?: unknown[] };
  try { body = JSON.parse(rawBody.toString('utf8')); }
  catch { return NextResponse.json({ ok: true }, { status: 200 }); }

  const events = body?.events ?? [];
  logger.info('Webhook received', { eventCount: events.length });

  for (const ev of events) {
    const event = ev as Record<string, unknown>;
    const type  = String(event.type ?? '');

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

        const resolvedBy = userId && groupId
          ? await getMemberName(groupId, userId)
          : 'สมาชิกสภา';

        // อัปเดต LINE message (เพื่อให้เห็น "ดำเนินการแล้ว" ใน LINE)
        const stored = getReport(reportId);

        if (stored) {
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
            deleteReport(reportId);
          } catch (err: unknown) {
            logger.error('updateMessage via postback failed', { error: String(err) });
          }
        } else {
          logger.warn('No stored messageId for reportId (possible cold start)', {
            reportId: reportId.slice(-8),
          });
        }

        // ✅ แจ้ง YPLABS ทุกครั้ง ไม่ว่าจะเจอ stored report หรือไม่
        // เพราะตอนนี้ YPLABS ใช้ Supabase DB จะหา report ได้เสมอ
        await notifyYplabsResolved({ reportId, resolvedBy, resolvedNote: null });
      }
    }

    if (type !== 'postback') {
      const source = (event.source as Record<string, string> | undefined)?.type ?? 'unknown';
      logger.debug('Non-postback event ignored', { type, source });
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
