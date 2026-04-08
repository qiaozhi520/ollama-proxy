'use strict';

import express, { Request, Response, Router } from 'express';
import { registry } from '../models/registry';

const router: Router = express.Router();

// ── GET /api/show ─────────────────────────────────────────────
// 返回指定模型的详细信息（Ollama show 模型名 API）
router.get('/', (req: Request, res: Response) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '"name" query param required' });

  const model = registry.get(name as string);
  if (!model) return res.status(404).json({ error: `model "${name}" not found` });

  res.json({
    name,
    display_name:  model.display_name || model.name,
    provider:      model.provider,
    model_id:      model.model_id     || model.name,
    modified_at:   new Date().toISOString(),
    size:          0,
    digest:        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    details: {
      parent_model:       '',
      format:             'chat',
      family:             model.provider,
      families:           [model.provider],
      parameter_size:     '',
      quantization_level: 'Q4_0',
      context_length:     model.context_length,
      supports_tools:    model.supports_tools,
      supports_vision:   model.supports_vision,
    },
    capabilities: {
      completion:   true,
      chat:         true,
      embedding:    false,
      multi_modal:  model.supports_vision || false,
    },
  });
});

export default router;