'use strict';

const express = require('express');
const registry = require('../models/registry');
const router = express.Router();

// ── POST /api/blobs/:digest ──────────────────────────────────
// 推送 blob（代理模式不支持）
router.post('/:digest', (req, res) => {
  const { digest } = req.params;
  res.status(501).json({ 
    error: 'Blob storage not supported in proxy mode',
    digest
  });
});

// ── HEAD /api/blobs/:digest ──────────────────────────────────
// 检查 blob 是否存在
router.head('/:digest', (req, res) => {
  const { digest } = req.params;
  res.status(404).end(); // 总是返回不存在
});

// ── GET /api/blobs/:digest ───────────────────────────────────
// 获取 blob
router.get('/:digest', (req, res) => {
  const { digest } = req.params;
  res.status(404).json({ 
    error: 'Blob not found',
    digest
  });
});

module.exports = router;
