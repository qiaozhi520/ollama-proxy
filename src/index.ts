import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { log } from './utils/logger';
import { registry } from './models/registry';

// ── 路由 ─────────────────────────────────────────────────────
import apiRoute  from './routes/api';
import chatRoute from './routes/chat';
import tagsRoute from './routes/tags';
import showRoute from './routes/show';

// ── 应用 ─────────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT || '11434', 10);

// ── 中间件 ───────────────────────────────────────────────────
app.set('json spaces', 2);

if (process.env.CORS_ENABLED !== 'false') {
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['*'] }));
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 请求日志 ─────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  log.debug(`${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────
//  Ollama 兼容路由
// ─────────────────────────────────────────────────────────────

// GET /                           — 服务信息
app.get('/', (_req: Request, res: Response) => {
  res.json({
    status:  'ok',
    version: '1.0.0',
    name:    'ollama-proxy',
    models:  registry.list().length,
  });
});

// GET /api/tags                   — 列出所有模型
app.use('/api/tags', tagsRoute);

// GET /api/show                   — 查看模型详情
app.use('/api/show', showRoute);

// POST /api/chat                  — 对话（流式/非流式）
app.use('/api/chat', chatRoute);

// POST /api/generate              — 非流式生成
app.use('/api/generate', apiRoute);

// ─────────────────────────────────────────────────────────────
//  OpenAI 兼容路由（/v1/*）
// ─────────────────────────────────────────────────────────────

// POST /v1/chat/completions       — OpenAI 风格对话
app.use('/v1/chat', chatRoute);

// POST /v1/completions            — 文本补全（降级到 /chat）
app.post('/v1/completions', (req: Request, res: Response) => {
  const { prompt, _model, stream, temperature, max_tokens, options } = req.body as Record<string, unknown>;
  if (prompt) {
    req.body.messages = [{ role: 'user', content: prompt }];
  }
  req.body.stream = stream !== undefined ? stream : true;
  if (temperature) req.body.options = { ...(options as Record<string, unknown>), temperature };
  if (max_tokens)  req.body.options = { ...(options as Record<string, unknown>), num_predict: max_tokens };
  (chatRoute as unknown)(req, res);
});

// GET  /v1/models                 — 模型列表（OpenAI 风格）
app.get('/v1/models', (_req: Request, res: Response) => {
  const models = registry.list().map(m => ({
    id:      m.name,
    object:  'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: m.provider,
    permission: [],
  }));
  res.json({ object: 'list', data: models });
});

// ─────────────────────────────────────────────────────────────
//  健康检查
// ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

// ─────────────────────────────────────────────────────────────
//  404 / 错误处理
// ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: `Route not found: ${_req.method} ${_req.path}` });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// ── 启动 ─────────────────────────────────────────────────────
const server = http.createServer(app);
server.listen(PORT, () => {
  log.info(`Ollama Proxy 启动完成`);
  log.info(`  本地地址:  http://localhost:${PORT}`);
  log.info(`  模型数量:  ${registry.list().length}`);
  log.info('');
  log.info('支持的 API 端点:');
  log.info('  Ollama 风格:  /api/chat  /api/generate  /api/tags  /api/show');
  log.info('  OpenAI 风格:  /v1/chat/completions  /v1/models');
  log.info('');
  log.info('配置模型文件:  config/models.yaml');
});

// 优雅退出
process.on('SIGINT',  () => { log.info('收到 SIGINT，退出'); process.exit(0); });
process.on('SIGTERM', () => { log.info('收到 SIGTERM，退出'); process.exit(0); });