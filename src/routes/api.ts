'use strict';

import express, { Request, Response, Router } from 'express';
import { registry } from '../models/registry';
import { getAdapter } from '../models/adapters/adapters';
import { forwardRequest } from '../utils/net';
import { ResolvedModel, OllamaChatBody } from '../types';

const router: Router = express.Router();

function sendError(res: Response, err: Error & { status?: number }) {
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
router.post('/generate', async (req: Request, res: Response) => {
  const body = req.body as OllamaChatBody;
  const { model, messages, stream, options, tools } = body;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolvedModel = registry.get(model);
  if (!resolvedModel) {
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  const cfg      = registry.resolveConfig(resolvedModel) as ResolvedModel;
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
    sendError(res, err as Error & { status?: number });
  }
});

export default router;