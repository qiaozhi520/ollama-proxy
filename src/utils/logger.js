'use strict';

/**
 * 简易日志工具
 * 支持颜色输出（终端）、透明 JSON 结构日志
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL || 'info'];

function fmt(level, label, color, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `\x1b[${color}m[${ts}][${label}]\x1b[0m`;
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ');
  console[level](prefix, msg);
}

const log = {
  debug: (...a) => CURRENT <= 0 && fmt('log',   'DEBUG', '90', ...a),
  info:  (...a) => CURRENT <= 1 && fmt('info',  'INFO',  '36', ...a),
  warn:  (...a) => CURRENT <= 2 && fmt('warn',  'WARN',  '33', ...a),
  error: (...a) => CURRENT <= 3 && fmt('error', 'ERROR', '31', ...a),
};

module.exports = log;
