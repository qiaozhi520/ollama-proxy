'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');
const log   = require('./logger');

const logger = log.child('http');

// ── 配置 ─────────────────────────────────────────────────────
const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '120000', 10);

// ── 请求头构建 ───────────────────────────────────────────────
function buildHeaders(apiKey, provider) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent':   'ollama-proxy/1.0',
    'Accept':       'application/json, text/event-stream, */*',
  };

  if (provider === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = process.env.ANTHROPIC_VERSION || '2023-06-01';
  } else if (provider === 'gemini') {
    // Gemini API key 在 URL 中
  } else {
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

// ── 普通请求 ─────────────────────────────────────────────────
function request(endpoint, apiKey, provider, body) {
  return new Promise((resolve, reject) => {
    const t = log.timer();
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpMod = isHttps ? https : http;

    const postData = JSON.stringify(body);
    const headers  = buildHeaders(apiKey, provider);

    const options = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:    url.port || (isHttps ? 443 : 80),
      path:    url.pathname + url.search,
    };

    const req = httpMod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (!raw) return resolve({});

        try {
          const data = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const err = new Error(data.error?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.type   = data.error?.type;
            err.code   = data.error?.code;
            logger.error(`请求失败 ${endpoint} → ${res.statusCode} (${t.elapsed().toFixed(0)}ms)`);
            return reject(err);
          }
          logger.debug(`请求成功 ${endpoint} (${t.elapsed().toFixed(0)}ms)`);
          resolve(data);
        } catch (e) {
          logger.error(`解析响应失败: ${raw.slice(0, 200)}`);
          const err = new Error(`Failed to parse response`);
          err.status = 502;
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      logger.error(`请求错误: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.setTimeout(TIMEOUT);
    req.write(postData);
    req.end();
  });
}

// ── 流式请求 ─────────────────────────────────────────────────
function stream(endpoint, apiKey, provider, body) {
  return new Promise((resolve, reject) => {
    const t = log.timer();
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpMod = isHttps ? https : http;

    const postData = JSON.stringify(body);
    const headers  = buildHeaders(apiKey, provider);

    const options = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:    url.port || (isHttps ? 443 : 80),
      path:    url.pathname + url.search,
    };

    const req = httpMod.request(options, (res) => {
      if (res.statusCode >= 400) {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try {
            const d = JSON.parse(raw);
            reject(new Error(d.error?.message || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        return;
      }
      logger.debug(`流式连接建立 ${endpoint} (${t.elapsed().toFixed(0)}ms)`);
      resolve(res);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Stream timeout'));
    });

    req.setTimeout(TIMEOUT);
    req.write(postData);
    req.end();
  });
}

module.exports = { request, stream, buildHeaders };
