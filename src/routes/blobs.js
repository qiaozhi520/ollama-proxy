'use strict';

const express = require('express');

const router = express.Router();

// ── POST /api/blobs/:digest ──────────────────────────────────
router.post('/:digest', (req, res) => {
  res.status(501).json({
    error:  'Blob storage not supported in proxy mode',
    digest: req.params.digest,
  });
});

// ── HEAD /api/blobs/:digest ──────────────────────────────────
router.head('/:digest', (_req, res) => {
  res.status(404).end();
});

// ── GET /api/blobs/:digest ───────────────────────────────────
router.get('/:digest', (req, res) => {
  res.status(404).json({
    error:  'Blob not found',
    digest: req.params.digest,
  });
});

module.exports = router;
