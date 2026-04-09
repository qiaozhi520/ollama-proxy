'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('yaml');
const log  = require('../utils/logger');

const logger = log.child('registry');

let _models = [];

// ── 环境变量解析 ─────────────────────────────────────────────

function resolveEnv(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const val = process.env[name];
    if (val === undefined) {
      logger.warn(`环境变量 ${name} 未定义`);
      return '';
    }
    return val;
  });
}

function resolveConfig(obj) {
  if (typeof obj === 'string') return resolveEnv(obj);
  if (Array.isArray(obj)) return obj.map(resolveConfig);
  if (obj && typeof obj === 'object') {
    const resolved = {};
    for (const [k, v] of Object.entries(obj)) {
      resolved[k] = resolveConfig(v);
    }
    return resolved;
  }
  return obj;
}

// ── 配置加载 ─────────────────────────────────────────────────

function loadConfig() {
  const configPath = path.resolve(__dirname, '../../config/models.yaml');
  if (!fs.existsSync(configPath)) {
    logger.error(`配置文件不存在: ${configPath}`);
    _models = [];
    return _models;
  }

  const t = log.timer('config-load');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.parse(raw);

  if (!config?.models) {
    logger.error('配置文件格式错误或无 models 节');
    _models = [];
    return _models;
  }

  _models = config.models
    .filter(m => m.enabled !== false)
    .map(m => ({
      name: m.name,
      provider: m.provider || 'openai',
      ...m,
    }))
    .filter(m => {
      // 检查 API key 是否可用（解析环境变量后非空）
      const apiKey = resolveEnv(m.api_key);
      if (!apiKey) {
        logger.debug(`跳过 ${m.name}: ${m.api_key} 对应的 key 为空`);
        return false;
      }
      return true;
    });

  logger.info(`已加载 ${_models.length} 个模型 (共 ${config.models.filter(m => m.enabled !== false).length} 个已启用, ${_models.length} 个有 key) [${t.elapsed().toFixed(1)}ms]`);
  return _models;
}

// ── 模型查找 ─────────────────────────────────────────────────

function get(name) {
  // 精确匹配
  let model = _models.find(m => m.name === name);
  if (model) return model;

  // 去前缀匹配（"gpt-4o" → "openai/gpt-4o"）
  model = _models.find(m => {
    const parts = m.name.split('/');
    return parts.length > 1 && parts[1] === name;
  });
  if (model) return model;

  // 后缀匹配
  model = _models.find(m => m.name.endsWith('/' + name));
  if (model) return model;

  // 别名匹配
  model = _models.find(m => m.aliases?.includes(name));
  if (model) return model;

  return null;
}

// ── 列表 ─────────────────────────────────────────────────────

function list() {
  return _models.map(m => {
    const cfg = resolveConfig(m);
    return {
      name:         m.name,
      display_name: m.display_name || m.name,
      provider:     m.provider,
      model_id:     m.model_id || m.name,
      modified_at:  new Date().toISOString(),
      size:         cfg.size || 0,
      digest:       cfg.api_key ? `sha256:${Buffer.from(cfg.api_key).toString('hex').slice(0, 64)}` : 'sha256:' + '0'.repeat(64),
      details: {
        parent_model:       '',
        format:             'proxy',
        family:             m.provider,
        families:           [m.provider],
        parameter_size:     cfg.parameter_size || '',
        quantization_level: cfg.quantization || '',
      },
    };
  });
}

function resolve(model) {
  return resolveConfig(model);
}

function reload() {
  logger.info('重新加载配置...');
  return loadConfig();
}

// ── 初始化 ───────────────────────────────────────────────────
loadConfig();

module.exports = { load: loadConfig, reload, get, list, resolve, resolveConfig };
