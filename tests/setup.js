const request = require('supertest');

// 创建测试用的 app 实例（不启动服务器）
function createTestApp() {
  process.env.PORT = '0'; // 随机端口
  process.env.LOG_LEVEL = 'error'; // 减少日志输出
  
  const express = require('express');
  const cors = require('cors');
  const registry = require('../src/models/registry');
  
  const app = express();
  app.use(cors({ origin: '*' }));
  app.use(express.json());
  
  // 加载路由
  app.get('/', (_req, res) => {
    res.json({ status: 'ok', version: 'test', models: registry.list().length });
  });
  
  app.use('/api/tags', require('../src/routes/tags'));
  app.use('/api/version', require('../src/routes/version'));
  app.use('/api/show', require('../src/routes/show'));
  
  return app;
}

module.exports = { createTestApp, request };
