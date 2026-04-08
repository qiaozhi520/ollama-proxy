'use strict';

import express, { Request, Response, Router } from 'express';
import { registry } from '../models/registry';

const router: Router = express.Router();

// ── GET /api/tags ──────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const models = registry.list().map(m => ({
    name:         m.name,
    display_name: m.display_name || m.name,
    provider:     m.provider,
    model_id:     m.model_id     || m.name,
    modified_at:  new Date().toISOString(),
    size:         0,
    digest:       'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    details: {
      parent_model:       '',
      format:             'chat',
      family:             m.provider,
      families:           [m.provider],
      parameter_size:     '',
      quantization_level: 'Q4_0',
    },
  }));

  res.json({ models });
});

export default router;