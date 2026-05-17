// Path:    src/lib/env.ts
// Purpose: Centralized environment variable access with startup validation.
//          Single source of truth — all env reads go through here.
// Used by: src/lib/line.ts, src/app/api/receive/route.ts, src/app/api/webhook/route.ts

// ── LINE API ─────────────────────────────────────────────────────

export const LINE_CHANNEL_ACCESS_TOKEN: string =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '';

export const LINE_CHANNEL_SECRET: string =
  process.env.LINE_CHANNEL_SECRET ?? '';

// Target group that receives all Opslert alerts
export const LINE_GROUP_ID: string =
  process.env.LINE_GROUP_ID ?? '';

// ── Security ─────────────────────────────────────────────────────

// Shared secret — YPLABS sends this, we verify it
export const WEBHOOK_SECRET: string =
  process.env.WEBHOOK_SECRET ?? '';

// ── Validation ────────────────────────────────────────────────────

/**
 * Asserts that all required env vars are set.
 * Call at the top of API routes that depend on LINE to fail fast.
 */
export function assertLineConfig(context: string): void {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error(`[${context}] Missing LINE_CHANNEL_ACCESS_TOKEN`);
  }
  if (!LINE_CHANNEL_SECRET) {
    throw new Error(`[${context}] Missing LINE_CHANNEL_SECRET`);
  }
  if (!LINE_GROUP_ID) {
    throw new Error(`[${context}] Missing LINE_GROUP_ID`);
  }
}

export function assertWebhookConfig(context: string): void {
  if (!WEBHOOK_SECRET) {
    throw new Error(`[${context}] Missing WEBHOOK_SECRET`);
  }
}