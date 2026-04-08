import {
  Adapter,
  ResolvedModel,
  OllamaChatBody,
  OllamaMessage,
  OllamaToolCall,
  PROVIDER_ENDPOINTS,
} from '../../types';

// ── 通用映射工具 ──────────────────────────────────────────────

function mapRole(role: string): string {
  if (role === 'assistant') return 'assistant';
  if (role === 'user')      return 'user';
  if (role === 'system')    return 'system';
  return 'user';
}

function mapTools(tools: OllamaChatBody['tools']): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.function?.name        || '',
      description: t.function?.description || '',
      parameters:  t.function?.parameters  || { type: 'object', properties: {} },
    },
  }));
}

function resolveToolCalls(
  calls: unknown[] | undefined,
): OllamaToolCall[] | undefined {
  if (!calls || calls.length === 0) return undefined;
  return (calls as Array<{ index?: number; function?: { name?: string; arguments?: unknown } }>).map((c, i) => ({
    id: (c as { id?: string }).id || `call_${Date.now()}_${i}`,
    type: 'function' as const,
    function: {
      name:      c.function?.name       || '',
      arguments: typeof c.function?.arguments === 'string'
        ? c.function.arguments
        : JSON.stringify(c.function?.arguments || {}),
    },
    index: c.index ?? i,
  }));
}

// ── OpenAI 兼容适配器（OpenAI / DeepSeek / Groq / Silicon / Together） ──

const openaiAdapter: Adapter = {
  getEndpoint(cfg: ResolvedModel): string {
    const base = cfg.endpoint || PROVIDER_ENDPOINTS[cfg.provider] || PROVIDER_ENDPOINTS.openai;
    return `${base}/chat/completions`;
  },

  buildRequest(body: OllamaChatBody, cfg: ResolvedModel): unknown {
    const { messages, tools, options = {} } = body;

    const req: Record<string, unknown> = {
      model:   cfg.model_id || cfg.name,
      messages: messages.map((m: OllamaMessage) => {
        const msg: Record<string, unknown> = {
          role:    mapRole(m.role),
          content: typeof m.content === 'string' ? m.content : '',
        };
        if (m.images?.length) {
          // 多模态：以 content array 格式传给 OpenAI
          const parts: unknown[] = [];
          if (m.content && typeof m.content === 'string' && m.content)
            parts.push({ type: 'text', text: m.content });
          m.images.forEach(img => {
            parts.push({ type: 'image_url', image_url: { url: img } });
          });
          msg.content = parts;
        }
        if (m.tool_calls) {
          msg.tool_calls = m.tool_calls.map(tc => ({
            id:       tc.id       || `call_${Date.now()}`,
            type:     'function',
            function: {
              name:      tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
            },
            index: tc.index ?? 0,
          }));
        }
        return msg;
      }),
      stream: body.stream !== false,
    };

    if (tools && tools.length > 0) req.tools = mapTools(tools);
    if (body.temperature !== undefined)  req.temperature = body.temperature;
    if (options.temperature !== undefined) req.temperature = options.temperature;
    if (body.max_tokens !== undefined)    req.max_tokens = body.max_tokens;
    if (options.num_predict !== undefined) req.max_tokens = options.num_predict;
    if (options.top_p)               req.top_p               = options.top_p;
    if (options.top_k)               req.top_k               = options.top_k;
    if (options.frequency_penalty)   req.frequency_penalty   = options.frequency_penalty;
    if (options.presence_penalty)    req.presence_penalty    = options.presence_penalty;
    if (options.stop) {
      req.stop = Array.isArray(options.stop) ? options.stop : [options.stop];
    }

    return req;
  },

  mapStreamingChunk(events: unknown[], cfg: ResolvedModel): string {
    const outputs: string[] = [];

    for (const raw of events as Array<Record<string, unknown>>) {
      const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined;
      if (!choice) continue;

      const delta   = choice.delta as Record<string, unknown> | undefined;
      const tcDelta = delta?.tool_calls as Array<Record<string, unknown>> | undefined;

      const base = {
        model:       cfg.name,
        created:    (raw.created as number) || Math.floor(Date.now() / 1000),
        done:        false,
        message: {
          role:    (delta?.role as string)  || 'assistant',
          content: (delta?.content as string) || '',
        },
      } as Record<string, unknown>;

      if (tcDelta?.length) {
        base.message = {
          ...base.message,
          content:    '',
          tool_calls: tcDelta.map((tc, i) => ({
            function: {
              name:       (tc.function as Record<string, unknown>)?.name       || '',
              arguments:  typeof (tc.function as Record<string, unknown>)?.arguments === 'string'
                ? (tc.function as Record<string, unknown>).arguments
                : JSON.stringify((tc.function as Record<string, unknown>)?.arguments || {}),
            },
            index: (tc as { index?: number }).index ?? i,
          })),
        };
      }

      outputs.push('data: ' + JSON.stringify(base) + '\n\n');
    }

    return outputs.join('');
  },

  mapNonStreaming(data: unknown, cfg: ResolvedModel) {
    const raw = data as Record<string, unknown>;
    const choice = (raw.choices as Array<Record<string, unknown>> | undefined)?.[0] as Record<string, unknown> | undefined;
    if (!choice) return null;

    const msg = choice.message as Record<string, unknown> | undefined;
    if (!msg) return null;

    const response: Record<string, unknown> = {
      model:       cfg.name,
      created:    (raw.created as number) || Math.floor(Date.now() / 1000),
      done:       true,
      done_reason: choice.finish_reason as string || 'stop',
      message: {
        role:    (msg.role as string)    || 'assistant',
        content: (msg.content as string) || '',
      },
      total_duration: 0,
      eval_count:      (raw.usage as Record<string, number | undefined>)?.completion_tokens || 0,
    };

    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls?.length) {
      (response.message as Record<string, unknown>).tool_calls = resolveToolCalls(toolCalls);
    }

    return response as Parameters<Adapter['mapNonStreaming']>[1];
  },
};

// ── Anthropic 适配器 ─────────────────────────────────────────

const anthropicAdapter: Adapter = {
  getEndpoint(cfg: ResolvedModel): string {
    const base    = cfg.endpoint || PROVIDER_ENDPOINTS.anthropic;
    const _version = process.env.ANTHROPIC_VERSION || '2023-06-01';
    return `${base}/v1/messages`;
  },

  buildRequest(body: OllamaChatBody, cfg: ResolvedModel): unknown {
    const { messages, tools, options = {} } = body;

    const systemMsg = messages.find((m: OllamaMessage) => m.role === 'system');
    const chatMsgs  = messages.filter((m: OllamaMessage) => m.role !== 'system');

    // Anthropic 消息格式：每个 content 可以是 text 或 tool_use / tool_result blocks
    const buildContent = (m: OllamaMessage): unknown => {
      if (typeof m.content === 'string') return m.content;
      // 处理 content parts
      const parts = (m.content as unknown[])?.map((c) => {
        const part = c as Record<string, unknown>;
        if (part.type === 'image') return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: part.image || '' } };
        return { type: 'text', text: part.text || '' };
      }) || [];
      return parts.length > 0 ? parts : m.content;
    };

    const req: Record<string, unknown> = {
      model: cfg.model_id || cfg.name,
      messages: chatMsgs.map((m: OllamaMessage) => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: buildContent(m),
      })),
      stream:     body.stream !== false,
      max_tokens: body.max_tokens || options.num_predict || cfg.default_max_tokens || 4096,
    };

    if (systemMsg) {
      req.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : ((systemMsg.content as unknown[])?.map((c) => (c as Record<string, unknown>).text || '').join('') || '');
    }

    if (body.temperature !== undefined)  req.temperature = body.temperature;
    if (options.temperature !== undefined) req.temperature = options.temperature;
    if (options.top_p)  req.top_p = options.top_p;
    if (options.top_k)  req.top_k = options.top_k;

    if (tools && tools.length > 0) {
      req.tools = tools.map(t => ({
        name:        t.function?.name        || '',
        description: t.function?.description || '',
        input_schema: t.function?.parameters  || { type: 'object', properties: {} },
      }));
    }

    return req;
  },

  mapStreamingChunk(events: unknown[], cfg: ResolvedModel): string {
    const outputs: string[] = [];

    for (const raw of events as Array<Record<string, unknown>>) {
      const t = raw.type as string;
      const base = {
        model:    cfg.name,
        created:  Math.floor(Date.now() / 1000),
        done:     false,
        message:  { role: 'assistant' as const, content: '' },
      };

      if (t === 'content_block_start') {
        const block = raw.content_block as Record<string, unknown>;
        if (block?.type === 'tool_use') {
          (base.message as Record<string, unknown>).tool_calls = [{
            function: {
              name:      (block.name as string) || '',
              arguments: '',
            },
            index: (raw.index as number) ?? 0,
          }];
        }
        outputs.push('data: ' + JSON.stringify(base) + '\n\n');
      } else if (t === 'content_block_delta') {
        const delta = raw.delta as Record<string, unknown>;
        if (delta?.type === 'text_delta') {
          (base.message as Record<string, unknown>).content = delta.text as string;
          outputs.push('data: ' + JSON.stringify(base) + '\n\n');
        } else if (delta?.type === 'input_json_delta') {
          outputs.push('data: ' + JSON.stringify({
            ...base,
            message: {
              role:     'assistant',
              content:  '',
              tool_calls: [{
                function: { arguments: delta.partial_json },
                index: (raw.index as number) ?? 0,
              }],
            },
          }) + '\n\n');
        }
      } else if (t === 'message_delta') {
        // final
      }
    }

    return outputs.join('');
  },

  mapNonStreaming(data: unknown, cfg: ResolvedModel) {
    const msg = data as Record<string, unknown>;
    const contentArr = msg.content as Array<Record<string, unknown>> | undefined;

    const textParts    = contentArr?.filter(c => c.type === 'text')    || [];
    const toolParts    = contentArr?.filter(c => c.type === 'tool_use') || [];
    const textContent  = textParts.map((c: Record<string, unknown>) => c.text as string).join('');

    const toolCalls = toolParts.length > 0
      ? toolParts.map((b: Record<string, unknown>, i: number) => ({
          function: {
            name:      b.name as string || '',
            arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
          },
          index: (b.index as number) ?? i,
        }))
      : undefined;

    const usage = msg.usage as Record<string, number | undefined> | undefined;

    return {
      model:          cfg.name,
      created:        Math.floor(Date.now() / 1000),
      done:           true,
      done_reason:    msg.stop_reason as string || 'end_turn',
      message: {
        role:    'assistant',
        content: textContent,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      total_duration: 0,
      eval_count:      usage?.output_tokens || 0,
      eval_duration:   0,
      load_duration:   0,
    };
  },
};

// ── Gemini 适配器 ─────────────────────────────────────────────

const geminiAdapter: Adapter = {
  getEndpoint(cfg: ResolvedModel): string {
    const base    = cfg.endpoint || PROVIDER_ENDPOINTS.gemini;
    const _version = process.env.GEMINI_VERSION || 'v1beta';
    const modelId = cfg.model_id || cfg.name;
    return `${base}/models/${modelId}:generateContent?key=${cfg.api_key}`;
  },

  buildRequest(body: OllamaChatBody, cfg: ResolvedModel): unknown {
    const { messages, tools, options = {} } = body;

    const contents = messages
      .filter((m: OllamaMessage) => m.role !== 'system')
      .map((m: OllamaMessage) => {
        const parts: unknown[] = [];
        const text = typeof m.content === 'string' ? m.content : '';
        if (text) parts.push({ text });
        if (m.images?.length) {
          m.images.forEach(img => {
            parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } });
          });
        }
        return { role: m.role === 'model' ? 'model' : 'user', parts };
      });

    const genCfg: Record<string, unknown> = {
      temperature:    body.temperature ?? options.temperature ?? 0.7,
      maxOutputTokens: body.max_tokens ?? options.num_predict ?? cfg.default_max_tokens ?? 8192,
    };
    if (options.top_p) genCfg.topP = options.top_p;
    if (options.top_k) genCfg.topK = options.top_k;

    const req: Record<string, unknown> = { contents, generationConfig: genCfg };

    if (tools && tools.length > 0) {
      req.tools = {
        functionDeclarations: tools.map(t => ({
          name:        t.function?.name        || '',
          description: t.function?.description || '',
          parameters:  t.function?.parameters  || { type: 'object', properties: {} },
        })),
      };
    }

    return req;
  },

  mapStreamingChunk(events: unknown[], cfg: ResolvedModel): string {
    const outputs: string[] = [];

    for (const raw of events as Array<Record<string, unknown>>) {
      const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;
      if (!candidates?.length) continue;
      const parts = candidates[0].content as Record<string, unknown> | undefined;
      const partsArr = parts?.parts as Array<Record<string, unknown>> | undefined;
      if (!partsArr?.length) continue;

      for (const part of partsArr) {
        const base = {
          model:    cfg.name,
          created:  Math.floor(Date.now() / 1000),
          done:     (raw.done as boolean) || false,
          message:  { role: 'assistant' as const, content: '' },
        } as Record<string, unknown>;

        if (part.text) {
          (base.message as Record<string, unknown>).content = part.text;
        } else if (part.functionCall) {
          const fc = part.functionCall as Record<string, unknown>;
          base.message = {
            role:     'assistant',
            content:  '',
            tool_calls: [{
              function: {
                name:      fc.name as string || '',
                arguments: JSON.stringify(fc.args || {}),
              },
              index: 0,
            }],
          };
        }

        outputs.push('data: ' + JSON.stringify(base) + '\n\n');
      }
    }

    return outputs.join('');
  },

  mapNonStreaming(data: unknown, cfg: ResolvedModel) {
    const raw = data as Record<string, unknown>;
    const candidates = raw.candidates as Array<Record<string, unknown>> | undefined;

    if (!candidates?.length) {
      return {
        model:       cfg.name,
        created:     Math.floor(Date.now() / 1000),
        done:        true,
        done_reason: 'stop',
        message:     { role: 'assistant', content: '' },
        total_duration: 0,
        eval_count:  0,
      };
    }

    const parts     = (candidates[0].content as Record<string, unknown>)?.parts as Array<Record<string, unknown>> | undefined;
    const textPart  = parts?.find(p => p.text);
    const fcPart    = parts?.find(p => p.functionCall);
    const finishReason = candidates[0].finishReason as string;

    const response: Record<string, unknown> = {
      model:        cfg.name,
      created:      Math.floor(Date.now() / 1000),
      done:         true,
      done_reason:  finishReason || 'stop',
      message: {
        role:    'assistant',
        content: (textPart?.text as string) || '',
      },
      total_duration: 0,
      eval_count:  candidates[0].tokenCount as number || 0,
    };

    if (fcPart?.functionCall) {
      const fc = fcPart.functionCall as Record<string, unknown>;
      (response.message as Record<string, unknown>).tool_calls = [{
        function: {
          name:      fc.name as string || '',
          arguments: JSON.stringify(fc.args || {}),
        },
        index: 0,
      }];
      (response.message as Record<string, unknown>).content = '';
    }

    return response as Parameters<Adapter['mapNonStreaming']>[1];
  },
};

// ── 导出 & 路由 ───────────────────────────────────────────────

export const ADAPTERS: Record<string, Adapter> = {
  openai:    openaiAdapter,
  deepseek:  openaiAdapter,
  groq:      openaiAdapter,
  silicon:   openaiAdapter,
  together:  openaiAdapter,
  anthropic: anthropicAdapter,
  gemini:    geminiAdapter,
};

export function getAdapter(provider: string): Adapter {
  return ADAPTERS[provider] ?? openaiAdapter;
}
