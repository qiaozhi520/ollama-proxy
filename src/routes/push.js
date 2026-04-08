'use strict';

const express = require('express');
const router = express.Router();

// ── POST /api/push ───────────────────────────────────────────
// 推送模型（代理模式下返回提示信息）
router.post('/', async (req, res) => {
  const { name, stream } = req.body;

  if (!name) {
    return res.status(400).json({ error: '"name" is required' });
  }

  // 代理模式不支持推送
  if (stream !== false) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ status: 'pushing model' }) + '\n');
    res.write(JSON.stringify({ 
      status: 'not supported', 
      error: 'Push not supported in proxy mode. This proxy forwards to online LLM APIs.' 
    }) + '\n');
    res.end();
  } else {
    res.json({ 
      status: 'error',
      error: 'Push not supported in proxy mode'
    });
  }
});

module.exports = router;
