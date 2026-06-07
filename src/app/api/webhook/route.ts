// Path:    src/app/api/webhook/route.ts  (Opslert bot)
// Purpose: LINE webhook endpoint.
// ─── สิ่งที่เปลี่ยนแปลง ────────────────────────────────────────────────
// เปลี่ยนจาก updateMessage (PATCH) → replyMessage (replyToken)
//   - PATCH ใช้ไม่ได้กับบัญชีฟรี → 404 Not found
//   - replyToken ฟรี! ไม่เสีย push quota
//
// Flow ใหม่:
//   1. สมาชิกกด "✅ ดำเนินการแล้ว" → ได้ replyToken จาก LINE
//   2. ใช้ replyToken ส่ง Flex Message "ดำเนินการแล้ว" กลับไป (ฟรี!)
//   3. แจ้ง YPLABS อัปเดตสถานะบนเว็บ

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyLineSignature,
  buildResolvedFlex,
  replyMessage,        // ✅ ใช้ replyToken แทน updateMessage
  getMemberName,
} from '@/lib/line';
import { getReport, deleteReport, resolveModuleLabel } from '@/lib/botStore';
import { assertLineConfig } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/webhook');

export const dynamic = 'force-dynamic';

// ── Notify YPLABS web status ───────────────────────────────────────

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
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    logger.warn('notifyYplabs failed (non-fatal)');
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

    // ── Handle postback ────────────────────────────────────────────
    if (type === 'postback') {
      const postbackData = String((event.postback as any)?.data ?? '');
      const params       = new URLSearchParams(postbackData);
      const action       = params.get('action');
      const reportId     = params.get('reportId');
      const replyToken   = String((event as any).replyToken ?? '');

      logger.debug('Postback received', {
        action,
        reportId: reportId?.slice(-8),
        hasReplyToken: !!replyToken,
      });

      if (action === 'resolve' && reportId) {
        const source  = event.source as Record<string, string> | undefined;
        const userId  = source?.userId  ?? '';
        const groupId = source?.groupId ?? '';

        // 1. ดูชื่อคนที่กดปุ่ม
        const resolvedBy = userId && groupId
          ? await getMemberName(groupId, userId)
          : 'สมาชิกสภา';

        // 2. ดึงข้อมูลรายงานจาก botStore
        const stored = getReport(reportId);

        // 3. ✅ ส่ง reply message ด้วย replyToken (ฟรี! ไม่เสีย quota)
        if (replyToken && stored) {
          const flex = buildResolvedFlex({
            moduleLabel:  stored.moduleLabel,
            location:     stored.location,
            resolvedBy,
            resolvedNote: null,
          });

          try {
            await replyMessage(replyToken, [flex]);
            logger.info('Reply sent via postback', {
              reportId: reportId.slice(-8),
              resolvedBy,
            });
          } catch (err: unknown) {
            logger.error('replyMessage via postback failed', { error: String(err) });
            // ถ้า reply ล้มเหลว ไม่บล็อก — ให้ไปแจ้ง YPLABS ต่อ
          }

          deleteReport(reportId);
        } else if (replyToken && !stored) {
          // กรณี cold start — ไม่มีข้อมูลใน botStore แต่ยังส่ง reply ได้
          try {
            await replyMessage(replyToken, [{
              type: 'flex',
              altText: `✅ ดำเนินการแล้ว โดย ${resolvedBy}`,
              contents: {
                type: 'bubble',
                size: 'kilo',
                header: {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#E6F9EF',
                  paddingAll: '14px',
                  contents: [
                    { type: 'text', text: '✅ ดำเนินการแล้ว', weight: 'bold', color: '#0EA158', size: 'md' },
                  ],
                },
                body: {
                  type: 'box',
                  layout: 'vertical',
                  spacing: 'sm',
                  paddingAll: '14px',
                  contents: [
                    { type: 'text', text: `👤 โดย: ${resolvedBy}`, size: 'sm', weight: 'bold', color: '#272A48' },
                    { type: 'text', text: `⏰ ${new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, size: 'xs', color: '#9DA2C4' },
                  ],
                },
              },
            }]);
            logger.info('Fallback reply sent (no stored data)', {
              reportId: reportId.slice(-8),
              resolvedBy,
            });
          } catch (err: unknown) {
            logger.error('Fallback reply failed', { error: String(err) });
          }
        }

        // 4. แจ้ง YPLABS อัปเดตสถานะบนเว็บ
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
