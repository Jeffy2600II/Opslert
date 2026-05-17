// Path:    src/lib/line.ts
// Purpose: LINE Messaging API utilities — signature verification and message sending.
//          All LINE-related logic lives here; routes import only what they need.
// Used by: src/app/api/webhook/route.ts, src/app/api/receive/route.ts

import crypto from 'crypto';
import {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_GROUP_ID,
} from './env';

// ── Webhook signature verification ───────────────────────────────

/**
 * Verifies LINE webhook signature (HMAC-SHA256).
 * LINE docs: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
 */
export function verifyLineSignature(rawBody: Buffer, signature: string): boolean {
  const secret = LINE_CHANNEL_SECRET;
  if (!secret) return false;
  
  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    
    // Constant-time comparison prevents timing attacks
    const hashBuf = Buffer.from(hash);
    const sigBuf = Buffer.from(signature);
    
    if (hashBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, sigBuf);
  } catch {
    return false;
  }
}

// ── Message formatting ────────────────────────────────────────────

type AlertLevel = 'almost_empty' | 'empty';
type ReportType = 'paper';

type AlertPayload = {
  reportType: ReportType;
  alertLevel: AlertLevel;
  location: string;
  note ? : string;
};

/**
 * Builds a formatted Thai-language alert message for the LINE group.
 * Emoji and urgency markers differ by alert level.
 */
export function buildAlertMessage(payload: AlertPayload): string {
  const { reportType, alertLevel, location, note } = payload;
  
  const levelEmoji = alertLevel === 'empty' ? '🚨' : '⚠️';
  const levelLabel = alertLevel === 'empty' ? 'หมดแล้ว (ด่วน!)' : 'ใกล้หมดแล้ว';
  const urgency = alertLevel === 'empty' ?
    '⚡ โปรดเติมโดยด่วน' :
    '📋 ควรเติมในเร็วๆ นี้';
  
  const typeLabel = reportType === 'paper' ? 'กระดาษห่อผ้าอนามัย' : reportType;
  
  // Format time in Thai locale, UTC+7
  const now = new Date();
  const thTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const timeStr = thTime.toLocaleString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  const lines = [
    `${levelEmoji} แจ้งเตือน Opslert`,
    ``,
    `📋 ประเภท: ${typeLabel}`,
    `สถานะ: ${levelLabel}`,
    `📍 ตำแหน่ง: ${location}`,
  ];
  
  if (note && note.trim()) {
    lines.push(`📝 หมายเหตุ: ${note.trim()}`);
  }
  
  lines.push(``, `⏰ ${timeStr}`, urgency, ``, `— ส่งผ่าน Opslert`);
  
  return lines.join('\n');
}

// ── LINE API: send message to group ──────────────────────────────

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

type LineTextMessage = {
  type: 'text';
  text: string;
};

/**
 * Pushes a text message to the configured LINE group.
 * Throws if LINE API returns a non-2xx status.
 */
export async function sendGroupMessage(text: string): Promise < void > {
  const token = LINE_CHANNEL_ACCESS_TOKEN;
  const groupId = LINE_GROUP_ID;
  
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  if (!groupId) throw new Error('LINE_GROUP_ID not set');
  
  const message: LineTextMessage = { type: 'text', text };
  
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [message],
    }),
  });
  
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }
}