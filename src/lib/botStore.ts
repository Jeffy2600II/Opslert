// Path:    src/lib/botStore.ts  (Opslert bot)
// Purpose: Shared in-memory store — maps reportId → { messageId, reportData }
//          Imported by both api/receive (write) and api/webhook (read/delete)
//          so they share state within the same process/warm instance.
//
//          Resets on cold start. Acceptable since:
//            • Postback buttons in old messages will fail silently (update returns 404)
//            • YPLABS still holds authoritative resolve state
//            • Cold starts are rare during school hours

import { REPORT_MODULES } from './opslertConfig';

export type BotReportEntry = {
  messageId:   string;
  reportType:  string;
  moduleLabel: string;
  alertLevel:  string;
  location:    string;
  note?:       string;
  createdAt:   number; // ms timestamp
};

// TTL matches YPLABS cache (4 hours)
const TTL_MS = 4 * 60 * 60 * 1000;

const store = new Map<string, BotReportEntry>();

// ── Prune expired entries ──────────────────────────────────────────

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
}

// ── Public API ─────────────────────────────────────────────────────

export function setReport(reportId: string, entry: Omit<BotReportEntry, 'createdAt'>): void {
  prune();
  store.set(reportId, { ...entry, createdAt: Date.now() });
}

export function getReport(reportId: string): BotReportEntry | null {
  prune();
  return store.get(reportId) ?? null;
}

export function deleteReport(reportId: string): void {
  store.delete(reportId);
}

// Helper used by webhook — resolves moduleLabel from reportType if not cached
export function resolveModuleLabel(reportType: string): string {
  return REPORT_MODULES.find(m => m.id === reportType)?.label ?? reportType;
}