import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { z } from 'zod';
import { ModelConfig, ResolvedModel } from '../types';

// ── Zod Schema ────────────────────────────────────────────────

const ModelSchema = z.object({
  name:             z.string().min(1),
  display_name:     z.string().optional(),
  provider:         z.string().min(1),
  endpoint:         z.string().optional().default(''),
  api_key:          z.string().optional().default(''),
  model_id:         z.string().optional(),
  context_length:   z.number().optional().default(4096),
  supports_tools:   z.boolean().optional().default(false),
  supports_vision: z.boolean().optional().default(false),
  supports_streaming: z.boolean().optional().default(true),
  default_max_tokens: z.number().optional().default(4096),
  enabled:          z.boolean().optional().default(true),
});

// ── Model Registry ────────────────────────────────────────────

class ModelRegistry {
  private _models: ModelConfig[] = [];
  private _index = new Map<string, ModelConfig>();

  constructor() {
    this._load();
  }

  private _load(): void {
    const configPath = path.resolve(__dirname, '../../config/models.yaml');
    if (!fs.existsSync(configPath)) {
      console.warn(`[registry] models.yaml not found at ${configPath}`);
      return;
    }

    const raw  = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.parse(raw) as { models?: unknown };

    if (!Array.isArray(parsed?.models)) {
      throw new Error('config/models.yaml must have a top-level "models" array');
    }

    const results = (parsed.models as unknown[]).map((m, i) => {
      try {
        return ModelSchema.parse(m);
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.warn(`[registry] model #${i + 1} "${(m as Record<string, unknown>).name}" skipped:`, err.errors[0]?.message);
        } else {
          console.warn(`[registry] model #${i + 1} skipped:`, String(err));
        }
        return null;
      }
    });

    this._models = results.filter((m): m is z.infer<typeof ModelSchema> => m !== null);
    this._buildIndex();
    console.log(`[registry] loaded ${this._models.length} models`);
  }

  private _buildIndex(): void {
    this._index.clear();
    for (const model of this._models) {
      if (!model.enabled) continue;
      this._index.set(model.name, model);
      if (model.model_id && model.model_id !== model.name) {
        this._index.set(model.model_id, model);
      }
    }
  }

  /** 解析 ${ENV_VAR} 占位符 */
  resolveApiKey(raw: string | undefined): string {
    if (!raw) return '';
    return raw.replace(/\$\{(\w+)\}/g, (_, varName: string) => process.env[varName] ?? '');
  }

  /** 替换模型配置中的环境变量占位符 */
  resolveConfig(model: ModelConfig): ResolvedModel {
    return {
      ...model,
      api_key:  this.resolveApiKey(model.api_key),
      endpoint: this.resolveApiKey(model.endpoint),
    };
  }

  get(name: string): ModelConfig | null {
    return this._index.get(name) ?? null;
  }

  list(): ModelConfig[] {
    return this._models.filter(m => m.enabled);
  }

  /** 热重载（不重启服务） */
  reload(): void {
    this._load();
  }
}

export const registry = new ModelRegistry();
