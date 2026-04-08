'use strict';

const express = require('express');
const router = express.Router();

// ── GET /api/version ─────────────────────────────────────────
// 获取版本信息
router.get('/', (_req, res) => {
  res.json({
    version: '0.1.48'  // 模拟 Ollama 版本
  });
});

module.exports = router;
