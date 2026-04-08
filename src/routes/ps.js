'use strict';

const express = require('express');
const router = express.Router();

// 模拟正在运行的模型（代理模式下实际不本地运行模型）
const runningModels = [];

// ── GET /api/ps ──────────────────────────────────────────────
// 列出当前正在运行的模型
router.get('/', (_req, res) => {
  // 代理模式下没有本地运行的模型
  // 返回空列表，或者可以返回最近使用的模型
  res.json({
    models: runningModels.map(m => ({
      name: m.name,
      model: m.model,
      size: m.size || 0,
      digest: m.digest || '',
      details: {
        parent_model: '',
        format: 'gguf',
        family: m.family || '',
        parameter_size: m.parameter_size || '',
        quantization_level: m.quantization || ''
      },
      expires_at: m.expires_at,
      size_vram: m.size_vram || 0
    }))
  });
});

// 添加运行中的模型（供其他模块调用）
router.addRunning = (model, info = {}) => {
  const existing = runningModels.find(m => m.name === model);
  if (!existing) {
    runningModels.push({
      name: model,
      model: model,
      ...info,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5分钟后过期
    });
  }
};

// 清理过期的模型
router.cleanup = () => {
  const now = new Date();
  for (let i = runningModels.length - 1; i >= 0; i--) {
    if (new Date(runningModels[i].expires_at) < now) {
      runningModels.splice(i, 1);
    }
  }
};

module.exports = router;
