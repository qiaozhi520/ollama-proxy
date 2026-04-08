'use strict';

const express = require('express');
const registry = require('../models/registry');
const { getAdapter } = require('../models/adapters/adapters');
const { forwardRequest } = require('../utils/net');
const router = express.Router();

function sendError(res, err) {
  console.error('[generate] upstream error:', err.message);
  const status = err.status || 502;
  res.status(status).json({
    error: {
      message: err.message || 'Upstream request failed',
      type:    err.type    || 'upstream_error',
      status,
    },
  });
}

// ── POST /api/generate ────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { model, messages, stream, options, tools } = req.body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolvedModel = registry.get(model);
  if (!resolvedModel) {
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  const cfg      = registry.resolveConfig(resolvedModel);
  const adapter  = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);
  const apiBody  = adapter.buildRequest({ messages, stream: false, options, tools }, cfg);

  if (!apiBody) {
    return res.status(400).json({ error: 'invalid request body for this model' });
  }

  try {
    const data     = await forwardRequest(endpoint, cfg.api_key, cfg.provider, apiBody, false);
    const response = adapter.mapResponse(false, data, cfg);
    if (!response) return res.status(502).json({ error: 'invalid response from upstream' });
    res.json(response);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
