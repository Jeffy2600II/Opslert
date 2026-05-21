// Path:    src/lib/botStore.ts  (Opslert bot)
// Purpose: Shared in-memory store — maps reportId → { messageId, reportData }
//          Imported by both api/receive (write) and api/webhook (read/delete)
//          so they share state within the same process/warm instance.
//
// ⚠️  This file must NOT import from YPLABS — both projects are separate deployments.
//     Module labels are defined inline here.

export type BotReportEntry = {
  messageId:   string;
  reportType:  string;
  moduleLabel: string;
  alertLevel:  string;
  location:    string;
  note?:       string;
  createdAt:   number;
};

// TTL matches YPLABS cache (4 hours)
const TTL_MS = 4 * 60 * 60 * 1000;

const store = new Map<string, BotReportEntry>();

// ── Module labels (kept in sync with YPLABS opslertConfig.ts manually) ─────
// When you add a new report type to YPLABS opslertConfig.ts, add it here too.

const MODULE_LABELS: Record<string, string> = {
  paper: 'กระดาษห่อผ้าอนามัย',
  // soap: 'สบู่ล้างมือ',   ← example: add new types here
};

export function resolveModuleLabel(reportType: string): string {
  return MODULE_LABELS[reportType] ?? reportType;
}

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