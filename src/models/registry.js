'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { z } = require('zod');

// ── Zod Schema ────────────────────────────────────────────────
const ModelSchema = z.object({
  name:            z.string().min(1),
  display_name:    z.string().optional(),
  provider:        z.string().min(1),
  endpoint:        z.string().optional().default(''),
  api_key:         z.string().optional().default(''),
  model_id:        z.string().optional(),
  context_length:  z.number().optional().default(4096),
  supports_tools:  z.boolean().optional().default(false),
  supports_vision: z.boolean().optional().default(false),
  supports_streaming: z.boolean().optional().default(true),
  default_max_tokens: z.number().optional().default(4096),
  enabled:         z.boolean().optional().default(true),
});

// ── Model Registry ────────────────────────────────────────────
class ModelRegistry {
  constructor() {
    this._models = [];
    this._index = new Map();
    this._load();
  }

  /** 从 YAML 文件加载模型配置 */
  _load() {
    const configPath = path.resolve(__dirname, '../../config/models.yaml');
    if (!fs.existsSync(configPath)) {
      console.warn(`[registry] models.yaml not found at ${configPath}`);
      return;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(raw);

    if (!Array.isArray(parsed.models)) {
      throw new Error('config/models.yaml must have a top-level "models" array');
    }

    this._models = parsed.models
      .map((m, i) => {
        try {
          return ModelSchema.parse(m);
        } catch (err) {
          console.warn(`[registry] model #${i + 1} skipped due to validation error:`, err.message);
          return null;
        }
      })
      .filter(Boolean);

    // 构建索引（支持模糊匹配：完整名称 / provider/model-id / model-id）
    this._buildIndex();

    console.log(`[registry] loaded ${this._models.length} models`);
  }

  _buildIndex() {
    this._index.clear();
    for (const model of this._models) {
      if (!model.enabled) continue;
      // 主键：完整名称
      this._index.set(model.name, model);
      // 兼容：仅 model_id
      if (model.model_id && model.model_id !== model.name) {
        this._index.set(model.model_id, model);
      }
    }
  }

  /** 根据名称查找模型 */
  get(name) {
    return this._index.get(name) || null;
  }

  /** 返回所有已启用模型 */
  list() {
    return this._models.filter(m => m.enabled);
  }

  /** 解析 ${ENV_VAR} 占位符为实际值 */
  resolveApiKey(raw) {
    if (!raw) return '';
    return raw.replace(/\$\{(\w+)\}/g, (_, varName) => process.env[varName] || '');
  }

  /** 替换配置中的环境变量占位符 */
  resolveConfig(model) {
    return {
      ...model,
      api_key:  this.resolveApiKey(model.api_key),
      endpoint: this.resolveApiKey(model.endpoint),
    };
  }
}

module.exports = new ModelRegistry();
