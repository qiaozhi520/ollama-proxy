'use strict';

/**
 * Ollama Proxy - 主入口
 *
 * 让 Ollama 兼容客户端直接连接在线 LLM API
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const http    = require('http');
const log     = require('./utils/logger');
const registry = require('./models/registry');

// ── 路由 ─────────────────────────────────────────────────────
const routes = {
  tags:       require('./routes/tags'),
  show:       require('./routes/show'),
  chat:       require('./routes/chat'),
  generate:   require('./routes/generate'),
  embeddings: require('./routes/embeddings'),
  create:     require('./routes/create'),
  copy:       require('./routes/copy'),
  delete:     require('./routes/delete'),
  ps:         require('./routes/ps'),
  pull:       require('./routes/pull'),
  push:       require('./routes/push'),
  version:    require('./routes/version'),
  blobs:      require('./routes/blobs'),
};

// ── 应用初始化 ───────────────────────────────────────────────
const app  = express();
const PORT = parseInt(process.env.PORT || '11434', 10);

// 中间件
app.set('json spaces', 2);
if (process.env.CORS_ENABLED !== 'false') {
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'], allowedHeaders: ['*'] }));
}
app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use(log.middleware);

// 调试中间件：记录所有 POST/DELETE 请求体
app.use((req, _res, next) => {
  if ((req.method === 'POST' || req.method === 'DELETE') && req.body && Object.keys(req.body).length > 0) {
    const logger = log.child('req');
    const { messages, system, prompt, tools, ...safeBody } = req.body;
    // 截断 messages/prompt 避免日志过大，但保留结构
    let summary = '';
    if (messages) {
      summary += `, messages=[${messages.length}条]`;
    }
    if (prompt) {
      summary += `, prompt="${String(prompt).slice(0, 50)}..."`;
    }
    if (tools) {
      summary += `, tools=[${tools.length}个]`;
    }
    logger.debug(`${req.method} ${req.path} body=${JSON.stringify(safeBody)}${summary}`);
  }
  next();
});

// ── Ollama API 路由 ─────────────────────────────────────────

// GET / - 服务信息
app.get('/', (_req, res) => {
  res.json({
    status:  'ok',
    version: '0.1.48',
    name:    'ollama-proxy',
    models:  registry.list().length,
  });
});

// GET /api/tags - 模型列表
app.use('/api/tags', routes.tags);

// POST /api/show - 模型详情
app.use('/api/show', routes.show);

// POST /api/chat - 对话
app.use('/api/chat', routes.chat);

// POST /api/generate - 文本生成
app.use('/api/generate', routes.generate);

// POST /api/embeddings - 向量嵌入
app.use('/api/embeddings', routes.embeddings);

// POST /api/create - 创建模型
app.use('/api/create', routes.create);

// POST /api/copy - 复制模型
app.use('/api/copy', routes.copy);

// DELETE /api/delete - 删除模型
app.use('/api/delete', routes.delete);

// GET /api/ps - 运行中的模型
app.use('/api/ps', routes.ps);

// POST /api/pull - 拉取模型
app.use('/api/pull', routes.pull);

// POST /api/push - 推送模型
app.use('/api/push', routes.push);

// GET /api/version - 版本信息
app.use('/api/version', routes.version);

// /api/blobs - Blob 存储
app.use('/api/blobs', routes.blobs);

// ── OpenAI 兼容路由 ─────────────────────────────────────────

// POST /v1/chat/completions
app.post('/v1/chat/completions', async (req, res, next) => {
  // 设置标记，要求返回 OpenAI 格式
  req._openaiFormat = true;
  
  const handler = routes.chat.stack.find(l => l.route?.path === '/');
  if (handler?.route?.stack?.[0]?.handle) {
    handler.route.stack[0].handle(req, res, next);
  } else {
    next();
  }
});

// POST /v1/completions (OpenAI 兼容)
app.post('/v1/completions', (req, res, next) => {
  const { prompt, stream } = req.body;
  req._openaiFormat = true;
  if (prompt) {
    req.body.messages = [{ role: 'user', content: prompt }];
  }
  req.body.stream = stream !== false;
  const handler = routes.chat.stack.find(l => l.route?.path === '/');
  if (handler?.route?.stack?.[0]?.handle) {
    handler.route.stack[0].handle(req, res, next);
  } else {
    next();
  }
});

// GET /v1/models
app.get('/v1/models', (_req, res) => {
  const models = registry.list().map(m => ({
    id:        m.name,
    object:    'model',
    created:   Math.floor(Date.now() / 1000),
    owned_by:  m.provider,
  }));
  res.json({ object: 'list', data: models });
});

// POST /v1/embeddings
app.post('/v1/embeddings', (req, res, next) => {
  const handler = routes.embeddings.stack.find(l => l.route?.path === '/');
  if (handler?.route?.stack?.[0]?.handle) {
    handler.route.stack[0].handle(req, res, next);
  } else {
    next();
  }
});

// ── 健康检查 ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

// ── 错误处理 ─────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: `Route not found: ${_req.method} ${_req.path}` });
});

app.use((err, _req, res, _next) => {
  log.child('server').error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

// ── 启动 ─────────────────────────────────────────────────────
const server = http.createServer(app);

server.listen(PORT, () => {
  const logger = log.child('server');
  logger.info(`Ollama Proxy 启动完成`);
  logger.info(`  地址:  http://localhost:${PORT}`);
  logger.info(`  模型:  ${registry.list().length} 个`);
  logger.info('');
  logger.info('Ollama API:');
  logger.info('  GET  /api/tags, /api/ps, /api/version');
  logger.info('  POST /api/chat, /api/generate, /api/embeddings, /api/show');
  logger.info('  POST /api/create, /api/copy, /api/pull, /api/push');
  logger.info('  DEL  /api/delete');
  logger.info('');
  logger.info('OpenAI API:');
  logger.info('  POST /v1/chat/completions, /v1/embeddings');
  logger.info('  GET  /v1/models');
});

// 优雅退出
process.on('SIGINT',  () => { log.info('收到 SIGINT，退出'); process.exit(0); });
process.on('SIGTERM', () => { log.info('收到 SIGTERM，退出'); process.exit(0); });

module.exports = app;
