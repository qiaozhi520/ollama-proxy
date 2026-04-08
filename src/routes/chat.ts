'use strict';

import express, { Request, Response, Router } from 'express';
import { registry } from '../models/registry';
import { getAdapter } from '../models/adapters/adapters';
import { forwardRequest, forwardStream } from '../utils/net';
import { ResolvedModel, OllamaChatBody } from '../types';

const router: Router = express.Router();

function flushSSEHeaders(res: Response): void {
  if (res.flushHeaders) {
    (res as unknown as { flushHeaders: () => void }).flushHeaders();
  } else if (res.flush) {
    (res as unknown as { flush: () => void }).flush();
  }
}

function flush(res: Response): void {
  if (res.flush) {
    (res as unknown as { flush: () => void }).flush();
  }
}

function handleErrorStream(res: Response, err: Error): void {
  if (!res.headersSent) {
    res.status(500).json({ error: err.message });
  } else {
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.end();
  }
}

function handleError(res: Response, err: Error & { status?: number }): void {
  console.error('[chat] upstream error:', err.message);
  const status = err.status || 502;
  res.status(status).json({
    error: {
      message:     err.message || 'Upstream request failed',
      type:        err.type    || 'upstream_error',
      code:        err.code    || undefined,
      status,
    },
  });
}

// ─────────────────────────────────────────────────────────────
//  POST /api/chat (流式 + 非流式)
// ─────────────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as OllamaChatBody;
  const model = body.model;

  if (!model) return res.status(400).json({ error: '"model" is required' });

  const resolvedModel = registry.get(model);
  if (!resolvedModel) {
    return res.status(404).json({ error: `model "${model}" not found` });
  }

  const cfg      = registry.resolveConfig(resolvedModel) as ResolvedModel;
  const adapter  = getAdapter(cfg.provider);
  const endpoint = adapter.getEndpoint(cfg);
  const apiBody  = adapter.buildRequest(body, cfg);

  const streaming = body.stream !== false;

  if (streaming) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    flushSSEHeaders(res);

    try {
      const stream = await forwardStream(endpoint, cfg.api_key, cfg.provider, apiBody, cfg);
      let buffer = '';
      let idleTimer: NodeJS.Timeout;

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        // Gemini/SSE 分块处理
        const events: unknown[] = [];
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const raw = JSON.parse(line.slice(6));
              events.push(raw);
            } catch {
              // ignore parse errors
            }
          } else if (line.startsWith('{')) {
            try {
              events.push(JSON.parse(line));
            } catch {
              // ignore parse errors
            }
          }
        }

        if (events.length > 0) {
          const out = adapter.mapResponse(true, events, cfg);
          if (out) {
            clearTimeout(idleTimer);
            res.write(out);
            flush(res);
            idleTimer = setTimeout(() => flush(res), 50);
          }
        }
      });

      stream.on('end', () => {
        clearTimeout(idleTimer);
        // 发送结束帧
        const done = adapter.mapResponse(false, { done: true, model: cfg.name }, cfg);
        if (done) {
          res.write('data: ' + JSON.stringify({
            model,
            created:   Math.floor(Date.now() / 1000),
            done:      true,
            done_reason: 'stop',
            message:   { role: 'assistant', content: '' },
          }) + '\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });

      stream.on('error', (err: Error) => {
        clearTimeout(idleTimer);
        if (!res.headersSent) {
          res.status(502).json({ error: err.message });
        } else {
          res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
          res.end();
        }
      });
    } catch (err) {
      handleErrorStream(res, err as Error);
    }
  } else {
    try {
      const data     = await forwardRequest(endpoint, cfg.api_key, cfg.provider, apiBody, false);
      const response = adapter.mapResponse(false, data, cfg);
      if (!response) return res.status(502).json({ error: 'invalid upstream response' });
      res.json(response);
    } catch (err) {
      handleError(res, err as Error & { status?: number; type?: string; code?: string });
    }
  }
});

export default router;