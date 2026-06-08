// Path:    src/app/api/broadcast/route.ts  (Opslert bot)
// Purpose: Called by YPLABS — supports multiple actions:
//   • resolve (default): Send resolved Flex Message when council marks report resolved
//   • delete: Delete a LINE message (for upgrade flow: delete old → send new)
//
// ─── สิ่งที่เปลี่ยนแปลง ────────────────────────────────────────────────
// เดิม: ใช้ PATCH /v2/bot/message/{messageId} → บัญชีฟรีใช้ไม่ได้ (404)
// ใหม่: ส่ง Flex Message ใหม่เข้ากลุ่มด้วย push (ใช้ 1 quota)
//   - ถ้า YPLABS ส่ง replyToken มาด้วย → ใช้ reply (ฟรี)
//   - ถ้าไม่มี replyToken → ใช้ push (1 quota)
// เพิ่ม: action=delete → ลบข้อความ LINE (สำหรับ upgrade flow)
//
// ⚠️ เนื่องจาก broadcast เรียกจาก YPLABS (ไม่ใช่จาก LINE event)
//    จึงไม่มี replyToken → ต้องใช้ push
//    แต่ถ้าไม่ต้องการเสีย quota → สามารถข้ามส่ง LINE ได้
//    โดยตั้ง broadcastMode=skip ใน ENV ของ Opslert

import { NextRequest, NextResponse } from 'next/server';
import { buildResolvedFlex, sendGroupFlex, sendGroupMessage, deleteMessage } from '@/lib/line';
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
  const action      = String(b.action      ?? 'resolve').trim(); // default: resolve
  const messageId   = String(b.messageId   ?? '').trim();
  const reportId    = String(b.reportId    ?? '').trim();
  const reportType  = String(b.reportType  ?? '').trim();
  const location    = String(b.location    ?? '').trim();
  const resolvedBy  = String(b.resolvedBy  ?? 'สมาชิกสภา').trim();
  const resolvedNote = b.resolvedNote ? String(b.resolvedNote).trim().slice(0, 200) : null;
  const replyToken   = String(b.replyToken ?? '').trim();

  if (!messageId && !reportId) {
    return NextResponse.json({ error: 'messageId or reportId is required' }, { status: 400 });
  }

  // ── action=delete: ลบข้อความเก่า (สำหรับ upgrade flow) ──
  if (action === 'delete') {
    if (!messageId) {
      return NextResponse.json({ error: 'messageId required for delete action' }, { status: 400 });
    }
    try {
      await deleteMessage(messageId);
      logger.info('Message deleted', { messageId: messageId.slice(-8) });
      // ล้าง botStore entry ด้วย (ถ้ามี reportId)
      if (reportId) deleteReport(reportId);
      return NextResponse.json({ ok: true, deleted: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Delete failed (non-fatal — old message will remain)', { error: msg, messageId: messageId.slice(-8) });
      // ไม่ถือว่า error — บัญชีฟรีอาจลบไม่ได้ แต่ flow ต่อไปยังส่งข้อความใหม่ได้
      return NextResponse.json({ ok: true, deleted: false, reason: msg });
    }
  }

  // ── action=resolve (default): ส่งข้อความดำเนินการแล้ว ──
  const moduleLabel = resolveModuleLabel(reportType);

  // ✅ ใหม่: ตรวจสอบ broadcastMode
  // - 'push': ส่งข้อความใหม่เข้ากลุ่ม (ใช้ 1 quota)
  // - 'skip': ข้ามการส่ง LINE (ประหยัด quota — เว็บอัปเดตเท่านั้น)
  // - 'reply': ใช้ replyToken ถ้ามี (ฟรี) ถ้าไม่มีก็ push
  const broadcastMode = (process.env.BROADCAST_MODE ?? 'push').trim() as 'push' | 'skip' | 'reply';

  if (broadcastMode === 'skip') {
    logger.info('Broadcast skipped (mode=skip)', { reportId: reportId?.slice(-8) });
  } else if (broadcastMode === 'reply' && replyToken) {
    // ใช้ replyToken ฟรี!
    const flex = buildResolvedFlex({ moduleLabel, location, resolvedBy, resolvedNote });
    try {
      const { replyMessage } = await import('@/lib/line');
      await replyMessage(replyToken, [flex]);
      logger.info('Reply sent (free)', { reportId: reportId?.slice(-8), resolvedBy });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Reply failed', { error: msg });
    }
  } else {
    // Push Flex Message ใหม่เข้ากลุ่ม (ใช้ 1 quota)
    const flex = buildResolvedFlex({ moduleLabel, location, resolvedBy, resolvedNote });
    try {
      await sendGroupFlex(flex);
      logger.info('Push sent (1 quota)', { reportId: reportId?.slice(-8), resolvedBy });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Push failed', { error: msg });
      return NextResponse.json({ error: `LINE push failed: ${msg}` }, { status: 502 });
    }
  }

  // Clean up bot store entry
  if (reportId) deleteReport(reportId);

  return NextResponse.json({ ok: true });
}
