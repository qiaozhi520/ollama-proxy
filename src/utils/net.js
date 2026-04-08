'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ── 超时配置 ─────────────────────────────────────────────────
const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '120000', 10);

// ── 通用请求头构建 ───────────────────────────────────────────
function buildHeaders(apiKey, provider) {
  const headers = {
    'Content-Type':  'application/json',
    'User-Agent':    'ollama-proxy/1.0',
    'Accept':        'application/json, text/event-stream, */*',
  };

  if (provider === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = process.env.ANTHROPIC_VERSION || '2023-06-01';
    delete headers['Content-Type'];
    headers['Content-Type'] = 'application/json';
  } else if (provider === 'gemini') {
    // Gemini API key goes in URL query param, not header
  } else {
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

// ── 普通请求（Promise）───────────────────────────────────────
function forwardRequest(endpoint, apiKey, provider, body, streaming) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpMod = isHttps ? https : http;

    const postData = JSON.stringify(body);
    const headers  = buildHeaders(apiKey, provider);

    const options = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
    };

    const req = httpMod.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        // 空响应（流式在另一个函数处理）
        if (!raw) return resolve({});
        try {
          const data = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const err = new Error(data.error?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.type   = data.error?.type;
            err.code   = data.error?.code;
            return reject(err);
          }
          resolve(data);
        } catch (e) {
          const err = new Error(`Failed to parse response: ${raw.slice(0, 200)}`);
          err.status = 502;
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.setTimeout(TIMEOUT);

    req.write(postData);
    req.end();
  });
}

// ── 流式请求 ─────────────────────────────────────────────────
function forwardStream(endpoint, apiKey, provider, body, cfg) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpMod = isHttps ? https : http;

    // Gemini 的 key 在 URL 里，不能在 body 中重复传
    const bodyForReq = { ...body };
    const postData = JSON.stringify(bodyForReq);
    const headers  = buildHeaders(apiKey, provider);

    const options = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
    };

    const req = httpMod.request(options, (res) => {
      if (res.statusCode >= 400) {
        let raw = '';
        res.on('data', c => raw += c.toString());
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
      resolve(res);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Stream timeout')); });
    req.setTimeout(TIMEOUT);

    req.write(postData);
    req.end();
  });
}

module.exports = { forwardRequest, forwardStream };
