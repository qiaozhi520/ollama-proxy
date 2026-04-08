const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

const COLORS: Record<string, string> = {
  debug: '90', info: '36', warn: '33', error: '31',
};

function fmt(level: string, ...args: unknown[]): void {
  const ts     = new Date().toISOString().slice(11, 23);
  const color  = COLORS[level] || '37';
  const prefix = `\x1b[${color}m[${ts}][${level.toUpperCase()}]\x1b[0m`;
  const msg    = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a),
  ).join(' ');
  console.log(prefix, msg);
}

export const log = {
  debug: (...a: unknown[]) => { if (CURRENT <= 0) fmt('debug', ...a); },
  info:  (...a: unknown[]) => { if (CURRENT <= 1) fmt('info', ...a); },
  warn:  (...a: unknown[]) => { if (CURRENT <= 2) fmt('warn', ...a); },
  error: (...a: unknown[]) => { if (CURRENT <= 3) fmt('error', ...a); },
};
