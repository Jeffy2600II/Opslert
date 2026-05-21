// Path:    src/lib/line.ts  (Opslert bot)
// Purpose: LINE Messaging API utilities.
//          • buildAlertFlex  — Flex Message + Postback button for new alerts
//          • buildResolvedFlex — Flex Message (resolved state, no buttons)
//          • sendGroupFlex   — push Flex to group, returns messageId
//          • updateMessage   — PATCH existing message (FREE, no quota)
//          • getMemberName   — get display name from postback event
// Used by: api/receive, api/broadcast, api/webhook

import crypto from 'crypto';
import {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_GROUP_ID,
} from './env';

const LINE_API = 'https://api.line.me/v2/bot';

// ── Helpers ───────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
  };
}

function thTime(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toLocaleString('th-TH', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
}

function alertLevelText(level: string): string {
  if (level === 'empty') return 'หมดแล้ว 🚨';
  if (level === 'almost_empty') return 'ใกล้หมดแล้ว ⚠️';
  return level;
}

// ── Webhook signature verification ────────────────────────────────

export function verifyLineSignature(rawBody: Buffer, signature: string): boolean {
  const secret = LINE_CHANNEL_SECRET;
  if (!secret) return false;
  try {
    const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const hBuf = Buffer.from(hash);
    const sBuf = Buffer.from(signature);
    if (hBuf.length !== sBuf.length) return false;
    return crypto.timingSafeEqual(hBuf, sBuf);
  } catch { return false; }
}

// ── Flex Message builders ─────────────────────────────────────────

type AlertPayload = {
  reportType:  string;
  moduleLabel: string;
  alertLevel:  string;
  location:    string;
  note?:       string;
  reportId:    string;
};

type ResolvedPayload = {
  moduleLabel:  string;
  location:     string;
  resolvedBy:   string;
  resolvedNote: string | null;
};

// Shared body content builder (alert)
function alertBodyContents(p: AlertPayload): object[] {
  const contents: object[] = [
    { type: 'text', text: `📋 ${p.moduleLabel}`, size: 'sm', weight: 'bold', color: '#272A48' },
    { type: 'text', text: `📍 ${p.location}`, size: 'sm', color: '#626899' },
    {
      type: 'text',
      text: alertLevelText(p.alertLevel),
      size: 'sm',
      weight: 'bold',
      color: p.alertLevel === 'empty' ? '#DC2626' : '#E07C12',
    },
  ];
  if (p.note) {
    contents.push({ type: 'text', text: `💬 ${p.note}`, size: 'xs', color: '#9DA2C4', wrap: true });
  }
  contents.push({ type: 'text', text: `⏰ ${thTime()}`, size: 'xs', color: '#9DA2C4' });
  return contents;
}

/** Flex Message for a new alert — includes "ดำเนินการแล้ว" postback button */
export function buildAlertFlex(p: AlertPayload): object {
  return {
    type: 'flex',
    altText: `🔔 แจ้งปัญหา: ${p.moduleLabel} — ${p.location} (${alertLevelText(p.alertLevel)})`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF3E0',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: '🔔 แจ้งปัญหา', weight: 'bold', color: '#E07C12', size: 'md' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: alertBodyContents(p),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#0EA158',
            height: 'sm',
            action: {
              type: 'postback',
              label: '✅ ดำเนินการแล้ว',
              // reportId embedded so webhook can look up the right report
              data: `action=resolve&reportId=${p.reportId}`,
              displayText: '✅ ดำเนินการแล้ว',
            },
          },
        ],
      },
    },
  };
}

/** Flex Message for resolved state — no buttons, header turns green */
export function buildResolvedFlex(p: ResolvedPayload): object {
  const bodyContents: object[] = [
    { type: 'text', text: `📋 ${p.moduleLabel}`, size: 'sm', color: '#626899' },
    { type: 'text', text: `📍 ${p.location}`, size: 'sm', color: '#626899' },
    { type: 'text', text: `👤 โดย: ${p.resolvedBy}`, size: 'sm', weight: 'bold', color: '#272A48' },
  ];
  if (p.resolvedNote) {
    bodyContents.push({ type: 'text', text: `📝 ${p.resolvedNote}`, size: 'xs', color: '#9DA2C4', wrap: true });
  }
  bodyContents.push({ type: 'text', text: `⏰ ${thTime()}`, size: 'xs', color: '#9DA2C4' });

  return {
    type: 'flex',
    altText: `✅ ดำเนินการแล้ว: ${p.moduleLabel} — ${p.location}`,
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
        contents: bodyContents,
      },
      // No footer = no buttons
    },
  };
}

// ── LINE API calls ─────────────────────────────────────────────────

/**
 * Push Flex Message to the LINE group.
 * Costs 1 push quota.
 * Returns the messageId for later PATCH updates.
 */
export async function sendGroupFlex(flex: object): Promise<string | null> {
  const groupId = LINE_GROUP_ID;
  if (!LINE_CHANNEL_ACCESS_TOKEN || !groupId) throw new Error('LINE config missing');

  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ to: groupId, messages: [flex] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  // LINE returns sentMessages[0].id for the message we just sent
  return (data?.sentMessages?.[0]?.id as string) ?? null;
}

/**
 * Update an existing LINE message in place.
 * Uses PATCH /v2/bot/message/{messageId} — does NOT consume push quota.
 * Used to show resolved state after council marks a report handled.
 */
export async function updateMessage(messageId: string, flex: object): Promise<void> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN missing');

  const res = await fetch(`${LINE_API}/message/${messageId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ messages: [flex] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE updateMessage failed (${res.status}): ${body}`);
  }
}

/**
 * Get a group member's display name (for showing who resolved via postback).
 * Non-fatal — falls back to 'สมาชิกสภา' on error.
 */
export async function getMemberName(groupId: string, userId: string): Promise<string> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return 'สมาชิกสภา';
  try {
    const res = await fetch(`${LINE_API}/group/${groupId}/member/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return 'สมาชิกสภา';
    const data = await res.json();
    return (data?.displayName as string) || 'สมาชิกสภา';
  } catch {
    return 'สมาชิกสภา';
  }
}

// ── Legacy plain-text send (kept for other uses) ───────────────────

export async function sendGroupMessage(text: string): Promise<void> {
  const groupId = LINE_GROUP_ID;
  if (!LINE_CHANNEL_ACCESS_TOKEN || !groupId) throw new Error('LINE config missing');
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed (${res.status}): ${body}`);
  }
}