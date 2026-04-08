'use strict';

const express = require('express');
const router = express.Router();

// ── POST /api/pull ───────────────────────────────────────────
// 拉取模型（代理模式下返回提示信息）
router.post('/', async (req, res) => {
  const { name, stream, insecure } = req.body;

  if (!name) {
    return res.status(400).json({ error: '"name" is required' });
  }

  // 代理模式不支持真正的拉取，返回提示
  const message = `Model "${name}" must be configured in config/models.yaml first.`;
  
  if (stream !== false) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ status: 'pulling model' }) + '\n');
    res.write(JSON.stringify({ status: 'not supported', error: message }) + '\n');
    res.end();
  } else {
    res.json({ 
      status: 'error',
      error: 'Pull not supported in proxy mode',
      message: 'Add models to config/models.yaml instead'
    });
  }
});

module.exports = router;
