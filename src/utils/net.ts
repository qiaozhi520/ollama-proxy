import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { UpstreamError } from '../types';

// ── 超时配置 ─────────────────────────────────────────────────

const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '120000', 10);

// ── 请求头构建 ───────────────────────────────────────────────

export function buildHeaders(apiKey: string, provider: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':   'ollama-proxy/1.0',
    'Accept':       'application/json, text/event-stream, */*',
  };

  if (provider === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = process.env.ANTHROPIC_VERSION || '2023-06-01';
  } else if (provider !== 'gemini') {
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

// ── 普通请求（Promise）───────────────────────────────────────
export function forwardRequest(
  endpoint: string,
  apiKey: string,
  provider: string,
  body: unknown,
  _streaming?: boolean, // kept for compatibility
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const url     = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const mod     = isHttps ? https : http;
    const postData = JSON.stringify(body);
    const headers  = buildHeaders(apiKey, provider);

    const options: http.RequestOptions = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
    };

    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (!raw) { resolve({}); return; }

        try {
          const data = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(
              (data.error as Record<string, string>)?.message || `HTTP ${res.statusCode}`,
            ) as UpstreamError;
            err.status = res.statusCode;
            err.type   = (data.error as Record<string, string>)?.type;
            err.code   = (data.error as Record<string, string>)?.code;
            return reject(err);
          }
          resolve(data);
        } catch {
          const err = new Error(`Failed to parse response: ${raw.slice(0, 200)}`) as UpstreamError;
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

export function forwardStream(
  endpoint: string,
  apiKey: string,
  provider: string,
  body: unknown,
  _cfg?: unknown, // kept for compatibility
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url     = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const mod     = isHttps ? https : http;
    const postData = JSON.stringify(body);
    const headers  = buildHeaders(apiKey, provider);

    const options: http.RequestOptions = {
      method:  'POST',
      headers,
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
    };

    const req = mod.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        let raw = '';
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          try {
            const d = JSON.parse(raw);
            reject(new Error((d.error as Record<string, string>)?.message || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
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

// ── 错误响应工具 ─────────────────────────────────────────────

export function sendError(res: http.ServerResponse, err: unknown): void {
  const msg  = err instanceof Error ? err.message : String(err);
  const code = (err as UpstreamError).status || 502;
  console.error('[error] upstream:', msg);

  if (!res.headersSent) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
  }
  res.end(JSON.stringify({
    error: {
      message: msg,
      type:    (err as UpstreamError).type || 'upstream_error',
      status:  code,
    },
  }));
}
