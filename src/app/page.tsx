// Path:    src/app/page.tsx
// Purpose: Minimal public landing page — confirms the bot is running.
//          Not a user-facing UI; just a health indicator.
// Used by: Anyone who navigates to opslert.vercel.app directly

export default function HomePage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      textAlign: 'center',
      gap: 16,
    }}>
      {/* Status badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(14,161,88,0.15)',
        border: '1px solid rgba(14,161,88,0.30)',
        borderRadius: 9999,
        padding: '6px 16px',
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#0EA158',
          animation: 'pulse 2s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0EA158', letterSpacing: '.08em' }}>
          ONLINE
        </span>
      </div>

      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, maxWidth: 340 }}>
        Opslert Bot — LINE alert system
        <br />
        สภานักเรียน ร.ร. คำยางพิทยา
        <br />
        <span style={{ fontSize: 11, color: '#334155', marginTop: 8, display: 'block' }}>
          ระบบนี้ทำงานในฐานะ API เท่านั้น — ไม่มีหน้า UI
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}