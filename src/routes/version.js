'use strict';

const express = require('express');

const router = express.Router();

// ── GET /api/version ─────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ version: '0.20.4' });
});

module.exports = router;
