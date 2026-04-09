'use strict';

const express = require('express');

const router = express.Router();

// ── POST /api/push ───────────────────────────────────────────
// 代理模式不支持推送
router.post('/', (req, res) => {
  const { name, stream } = req.body;

  if (!name) return res.status(400).json({ error: '"name" is required' });

  const msg = 'Push not supported in proxy mode. This proxy forwards to online LLM APIs.';

  if (stream !== false) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ status: 'pushing model' }) + '\n');
    res.write(JSON.stringify({ status: 'not supported', error: msg }) + '\n');
    res.end();
  } else {
    res.json({ status: 'error', error: msg });
  }
});

module.exports = router;
