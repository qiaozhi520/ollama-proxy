'use strict';

const express = require('express');

const router = express.Router();

// ── POST /api/pull ───────────────────────────────────────────
// 代理模式不支持拉取
router.post('/', (req, res) => {
  const { name, stream } = req.body;

  if (!name) return res.status(400).json({ error: '"name" is required' });

  const msg = `Model "${name}" must be configured in config/models.yaml.`;

  if (stream !== false) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.write(JSON.stringify({ status: 'pulling model' }) + '\n');
    res.write(JSON.stringify({ status: 'not supported', error: msg }) + '\n');
    res.end();
  } else {
    res.json({ status: 'error', error: 'Pull not supported in proxy mode', message: msg });
  }
});

module.exports = router;
