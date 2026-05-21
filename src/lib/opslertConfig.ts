// Path:    src/lib/opslertConfig.ts
// Purpose: Centralized config for Opslert report modules.
//          Add new report types here — pages, forms, and QR codes auto-adapt.
// Used by: src/app/opslert/page.tsx, src/app/opslert/report/page.tsx

// ── Types ──────────────────────────────────────────────────────────

export type AlertLevelConfig = {
  value: 'almost_empty' | 'empty';
  label: string;
  desc: string;
  color: string;
  bg: string;
};

export type ReportModule = {
  /** Unique ID — used in URL ?type=<id> and API payloads */
  id: string;
  emoji: string;
  label: string;
  /** Shown on hub cards and the report form header */
  desc: string;
  /** Short label for compact views */
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
  /** Selectable locations on the report form */
  locations: readonly string[];
  alertLevels: readonly AlertLevelConfig[];
};

// ── Module Registry ────────────────────────────────────────────────
//
// HOW TO ADD A NEW REPORT TYPE:
//   1. Append a new entry to REPORT_MODULES below
//   2. Set a unique `id` string (e.g. 'soap', 'tissue')
//   3. Define locations and alert levels appropriate for the type
//   4. The system automatically creates:
//      - A card on the Opslert hub
//      - A report form at /opslert/report?type=<id>
//      - A QR code at /api/opslert/qr?type=<id>

export const REPORT_MODULES: ReportModule[] = [
  
  // ── กระดาษห่อผ้าอนามัย ──────────────────────────────────────────
  {
    id: 'paper',
    emoji: '📄',
    label: 'กระดาษห่อผ้าอนามัย',
    shortLabel: 'ห้องน้ำหญิง',
    desc: 'แจ้งปัญหากระดาษห่อผ้าอนามัยที่ห้องน้ำหญิง',
    color: 'var(--brand)',
    bg: 'rgba(91,91,214,0.08)',
    border: 'rgba(91,91,214,0.18)',
    locations: [
      'ห้องน้ำหญิง ชั้น 1',
      'ห้องน้ำหญิง ชั้น 2',
      'ห้องน้ำหญิง ชั้น 3',
      'ห้องน้ำหญิง ชั้น 4',
      'อื่นๆ (ระบุในหมายเหตุ)',
    ],
    alertLevels: [
    {
      value: 'almost_empty',
      label: 'ใกล้หมดแล้ว',
      desc: 'เหลืออีกไม่นาน ควรเตรียมไว้ก่อน',
      color: 'var(--amber)',
      bg: 'var(--amber-bg)',
    },
    {
      value: 'empty',
      label: 'หมดแล้ว (ด่วน!)',
      desc: 'ไม่มีเหลือเลย ต้องการเติมทันที',
      color: 'var(--red)',
      bg: 'var(--red-bg)',
    }, ],
  },
  
  // ── เพิ่ม module ใหม่ที่นี่ ──────────────────────────────────────
  // {
  //   id:         'soap',
  //   emoji:      '🧴',
  //   label:      'สบู่ล้างมือ',
  //   shortLabel: 'ห้องน้ำ',
  //   desc:       'แจ้งปัญหาสบู่ล้างมือหมด',
  //   color:      'var(--green)',
  //   bg:         'var(--green-bg)',
  //   border:     'var(--green-border)',
  //   locations:  ['ห้องน้ำหญิง ชั้น 1', 'ห้องน้ำชาย ชั้น 1', ...],
  //   alertLevels: [...],
  // },
  
] as
const;

// ── Helpers ────────────────────────────────────────────────────────

export function getModule(id: string): ReportModule | null {
  return REPORT_MODULES.find(m => m.id === id) ?? null;
}

/** Returns true if id belongs to a registered module */
export function isValidModuleId(id: string): boolean {
  return REPORT_MODULES.some(m => m.id === id);
}

/** All valid module IDs as a string set (for API validation) */
export const VALID_MODULE_IDS: ReadonlySet < string > =
  new Set(REPORT_MODULES.map(m => m.id));