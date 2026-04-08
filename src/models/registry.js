'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('yaml');

let _models = [];
let _config = null;

// 解析环境变量占位符 ${VAR_NAME}
function resolveEnv(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const val = process.env[name];
    if (val === undefined) {
      console.warn(`[registry] 警告: 环境变量 ${name} 未定义`);
      return '';
    }
    return val;
  });
}

// 递归解析对象中的所有占位符
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

// 加载 YAML 配置
function loadConfig() {
  const configPath = path.resolve(__dirname, '../../config/models.yaml');
  if (!fs.existsSync(configPath)) {
    console.warn('[registry] 配置文件不存在:', configPath);
    return [];
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  _config = yaml.parse(raw);
  
  if (!_config || !_config.models) {
    console.warn('[registry] 配置文件格式错误或无模型');
    return [];
  }

  _models = _config.models.map(m => ({
    name: m.name,
    provider: m.provider || 'openai',
    ...m
  }));

  console.log(`[registry] 已加载 ${_models.length} 个模型`);
  return _models;
}

// 获取模型（支持别名查找）
function get(name) {
  // 精确匹配
  let model = _models.find(m => m.name === name);
  if (model) return model;

  // 无前缀匹配 (去掉 provider/ 前缀)
  model = _models.find(m => m.name.endsWith('/' + name));
  if (model) return model;

  // 别名匹配
  model = _models.find(m => m.aliases && m.aliases.includes(name));
  if (model) return model;

  return null;
}

// 列出所有模型
function list() {
  return _models.map(m => {
    const cfg = resolveConfig(m);
    return {
      name: m.name,
      modified_at: new Date().toISOString(),
      size: cfg.size || 0,
      digest: (cfg.api_key || '').slice(0, 12) || 'proxy',
      details: {
        parent_model: '',
        format: 'proxy',
        family: m.provider,
        parameter_size: cfg.parameter_size || '',
        quantization_level: cfg.quantization || ''
      }
    };
  });
}

// 获取模型的完整配置（解析环境变量）
function resolve(model) {
  return resolveConfig(model);
}

// 初始化
loadConfig();

module.exports = {
  load: loadConfig,
  get,
  list,
  resolve,
  resolveConfig
};
