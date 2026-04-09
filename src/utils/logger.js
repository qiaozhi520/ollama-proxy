'use strict';

/**
 * 结构化日志系统
 *
 * 特性：
 *   - 控制台彩色输出 + 可选 JSON 格式
 *   - 文件日志轮转（按天）
 *   - 请求 ID 追踪（req.log 挂载到每个请求）
 *   - 模块标签（[registry]、[chat]、[adapter:openai] 等）
 *   - 性能计时器
 */

const fs   = require('fs');
const path = require('path');

// ── 配置 ─────────────────────────────────────────────────────
const LEVELS   = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const COLORS   = { debug: '90', info: '36', warn: '33', error: '31', fatal: '35' };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 1;

// 文件日志配置
const LOG_DIR      = process.env.LOG_DIR || path.resolve(__dirname, '../../logs');
const LOG_FILE     = process.env.LOG_FILE || 'ollama-proxy.log';
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '10485760', 10); // 10MB
const LOG_JSON     = process.env.LOG_JSON === 'true'; // 纯 JSON 输出（适合容器环境）

// 请求/响应日志配置
const LOG_REQUEST_BODY   = process.env.LOG_REQUEST_BODY !== 'false';   // 默认打印请求体
const LOG_RESPONSE_BODY  = process.env.LOG_RESPONSE_BODY !== 'false';  // 默认打印响应体
const LOG_BODY_MAX_LEN   = parseInt(process.env.LOG_BODY_MAX_LEN || '2000', 10); // 截断长度

// 颜色码
const C_RESET  = '\x1b[0m';
const C_DIM    = '\x1b[2m';
const C_GRAY   = '\x1b[90m';

// ── 工具 ─────────────────────────────────────────────────────
function timestamp() {
  return new Date().toISOString();
}

function shortTimestamp() {
  return new Date().toISOString().slice(11, 23);
}

function colorize(level, text) {
  return `\x1b[${COLORS[level]}m${text}\x1b[0m`;
}

function formatMessage(args) {
  return args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

// ── 文件日志 ─────────────────────────────────────────────────
let logStream = null;
let currentLogFile = '';
let logSize = 0;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, LOG_FILE.replace('.log', `-${date}.log`));
}

function initFileLog() {
  try {
    ensureLogDir();
    currentLogFile = getLogFilePath();
    logSize = 0;
    if (fs.existsSync(currentLogFile)) {
      logSize = fs.statSync(currentLogFile).size;
    }
    logStream = fs.createWriteStream(currentLogFile, { flags: 'a' });
    logStream.on('error', () => { logStream = null; }); // 静默失败
  } catch {
    logStream = null;
  }
}

function rotateIfNeeded() {
  if (logSize > LOG_MAX_SIZE) {
    if (logStream) logStream.end();
    initFileLog();
  }
}

function writeToFile(jsonStr) {
  if (!logStream) return;
  const line = jsonStr + '\n';
  logStream.write(line);
  logSize += Buffer.byteLength(line);
  rotateIfNeeded();
}

// 每天检查文件日期
function checkDateChange() {
  const today = getLogFilePath();
  if (today !== currentLogFile) {
    if (logStream) logStream.end();
    initFileLog();
  }
}

// ── 计时器 ───────────────────────────────────────────────────
class Timer {
  constructor(label) {
    this.label = label;
    this.start = process.hrtime.bigint();
  }

  /** 返回毫秒 */
  elapsed() {
    const end = process.hrtime.bigint();
    return Number(end - this.start) / 1e6;
  }
}

// ── 创建子日志 ───────────────────────────────────────────────
function createChild(module) {
  const child = {};
  for (const level of Object.keys(LEVELS)) {
    child[level] = (...args) => log(level, module, ...args);
  }
  child.timer = (label) => new Timer(label || module);
  return child;
}

// ── 核心 log 函数 ───────────────────────────────────────────
function log(level, module, ...args) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const ts   = timestamp();
  const msg  = formatMessage(args);
  const meta = { level, time: ts, msg, module };

  // 添加 error 字段
  const errArg = args.find(a => a instanceof Error);
  if (errArg) {
    meta.error = { name: errArg.name, message: errArg.message, stack: errArg.stack };
  }

  // 控制台输出
  if (LOG_JSON) {
    console.log(JSON.stringify(meta));
  } else {
    const levelStr = colorize(level, level.toUpperCase().padEnd(5));
    const timeStr  = `${C_DIM}${shortTimestamp()}${C_RESET}`;
    const modStr   = module ? `${C_GRAY}[${module}]${C_RESET} ` : '';
    const msgColor = level === 'error' || level === 'fatal'
      ? `\x1b[${COLORS[level]}m${msg}\x1b[0m`
      : msg;
    console.log(`${timeStr} ${levelStr} ${modStr}${msgColor}`);
  }

  // 文件输出（始终 JSON 格式）
  writeToFile(JSON.stringify(meta));
}

// ── Express 中间件 ───────────────────────────────────────────
function requestLogger(req, res, next) {
  checkDateChange();
  const start = process.hrtime.bigint();
  const requestId = req.headers['x-request-id'] || Math.random().toString(36).slice(2, 10);

  // 挂载子日志到请求
  req.log = createChild(`${req.method} ${req.path}`);
  req.requestId = requestId;

  // 跳过日志的路径
  const skipPaths = ['/health', '/favicon.ico'];
  if (skipPaths.some(p => req.path === p)) return next();

  // 收集请求体（用于日志）
  let requestBody = null;
  if (LOG_REQUEST_BODY && req.body && Object.keys(req.body).length > 0) {
    requestBody = truncateBody(req.body);
  }

  // 拦截响应以记录响应体
  const originalJson = res.json.bind(res);
  let responseBody = null;
  
  res.json = (data) => {
    if (LOG_RESPONSE_BODY) {
      responseBody = truncateBody(data);
    }
    return originalJson(data);
  };

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'debug';
    
    const logData = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status,
      duration_ms: Math.round(ms),
    };

    // 添加请求体
    if (requestBody) {
      logData.request = requestBody;
    }

    // 添加响应体
    if (responseBody) {
      logData.response = responseBody;
    }

    log(level, 'http', `${req.method} ${req.originalUrl} ${status} ${ms.toFixed(1)}ms`, logData);
  });

  next();
}

// ── 截断请求/响应体 ───────────────────────────────────────────
function truncateBody(data) {
  if (!data) return data;
  
  let str;
  try {
    str = typeof data === 'string' ? data : JSON.stringify(data);
  } catch {
    return '[无法序列化]';
  }
  
  if (str.length > LOG_BODY_MAX_LEN) {
    return str.slice(0, LOG_BODY_MAX_LEN) + `... [截断 ${str.length - LOG_BODY_MAX_LEN} 字符]`;
  }
  return data;
}

// ── 导出 ─────────────────────────────────────────────────────
const logger = {
  debug:  (...a) => log('debug', '', ...a),
  info:   (...a) => log('info', '', ...a),
  warn:   (...a) => log('warn', '', ...a),
  error:  (...a) => log('error', '', ...a),
  fatal:  (...a) => log('fatal', '', ...a),
  child:  createChild,
  timer:  (label) => new Timer(label),
  middleware: requestLogger,
  Timer,
  LEVELS,
};

// 启动时初始化文件日志
initFileLog();
// 每分钟检查日期变更
setInterval(checkDateChange, 60000);

module.exports = logger;
