// Path:    src/lib/logger.ts
// Purpose: Structured server-side logger for Vercel Function Logs.
//          Single-line JSON output for easy grep and log parsing.
// Used by: All API routes

type LogLevel = 'info' | 'warn' | 'error' | 'debug';
type LogMeta  = Record<string, unknown>;

function formatMeta(meta?: LogMeta): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ' | ' + JSON.stringify(meta);
  } catch {
    return ' | [unserializable]';
  }
}

function log(level: LogLevel, context: string, message: string, meta?: LogMeta): void {
  const ts   = new Date().toISOString();
  const line = `[opslert:${level.toUpperCase()}] [${context}] ${message}${formatMeta(meta)}`;

  switch (level) {
    case 'error': console.error(`${ts} ${line}`); break;
    case 'warn':  console.warn(`${ts} ${line}`);  break;
    case 'debug': console.debug(`${ts} ${line}`); break;
    default:      console.log(`${ts} ${line}`);   break;
  }
}

/**
 * Creates a logger bound to a context label (API route or module name).
 * Usage: const logger = createLogger('api/receive')
 */
export function createLogger(context: string) {
  return {
    info:  (msg: string, meta?: LogMeta) => log('info',  context, msg, meta),
    warn:  (msg: string, meta?: LogMeta) => log('warn',  context, msg, meta),
    error: (msg: string, meta?: LogMeta) => log('error', context, msg, meta),
    debug: (msg: string, meta?: LogMeta) => log('debug', context, msg, meta),

    lineError: (operation: string, status: number, body: string) => {
      log('error', context, `LINE API error in ${operation}`, { status, body });
    },

    request: (method: string, meta?: LogMeta) => {
      log('info', context, `${method} request received`, meta);
    },

    authFail: (reason: string) => {
      log('warn', context, `Auth failed: ${reason}`);
    },
  };
}