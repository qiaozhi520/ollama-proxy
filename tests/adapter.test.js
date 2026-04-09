'use strict';

const { getAdapter, ENDPOINTS } = require('../src/models/adapters/adapters');

describe('Adapters', () => {
  describe('getAdapter', () => {
    test('should return openai-like adapter for openai', () => {
      const adapter = getAdapter('openai');
      expect(adapter).toBeDefined();
      expect(adapter.getEndpoint).toBeDefined();
    });

    test('should return openai-like adapter for deepseek', () => {
      const adapter = getAdapter('deepseek');
      expect(adapter).toBeDefined();
    });

    test('should return openai-like adapter for minimax', () => {
      const adapter = getAdapter('minimax');
      expect(adapter).toBeDefined();
    });

    test('should return anthropic adapter for anthropic', () => {
      const adapter = getAdapter('anthropic');
      expect(adapter).toBeDefined();
    });

    test('should return gemini adapter for gemini', () => {
      const adapter = getAdapter('gemini');
      expect(adapter).toBeDefined();
    });

    test('should fallback to openai for unknown provider', () => {
      const adapter = getAdapter('unknown');
      expect(adapter).toBeDefined();
    });
  });

  describe('ENDPOINTS', () => {
    test('should have all required providers', () => {
      expect(ENDPOINTS.openai).toBeDefined();
      expect(ENDPOINTS.deepseek).toBeDefined();
      expect(ENDPOINTS.minimax).toBeDefined();
      expect(ENDPOINTS.anthropic).toBeDefined();
      expect(ENDPOINTS.gemini).toBeDefined();
    });
  });

  describe('OpenAI-like adapter', () => {
    const adapter = getAdapter('openai');

    test('should build request correctly', () => {
      const body = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      };
      const model = { model_id: 'test-model', name: 'test' };

      const req = adapter.buildRequest(body, model);
      expect(req.model).toBe('test-model');
      expect(req.messages).toBeDefined();
      expect(req.stream).toBe(true);
    });

    test('should map streaming response with reasoning_content', () => {
      const chunks = [
        {
          id: 'chatcmpl-123',
          choices: [{
            delta: {
              role: 'assistant',
              reasoning_content: 'Let me think about this...',
            },
            index: 0,
          }],
          created: 1234567890,
        },
        {
          id: 'chatcmpl-123',
          choices: [{
            delta: {
              content: 'Final answer',
            },
            index: 0,
            finish_reason: 'stop',
          }],
          created: 1234567890,
        },
      ];
      const model = { name: 'deepseek-chat' };

      const result = adapter.mapResponse(true, chunks, model);
      
      // reasoning_content 会被转换为 thinking 字段（Ollama 格式）
      expect(result).toContain('thinking');
      expect(result).toContain('Let me think about this...');
    });

    test('should map non-streaming response with reasoning_content', () => {
      const data = {
        id: 'chatcmpl-123',
        model: 'deepseek-chat',
        choices: [{
          message: {
            role: 'assistant',
            content: 'Final answer',
            reasoning_content: 'My thinking process...',
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        created: 1234567890,
      };
      const model = { name: 'deepseek-chat' };

      const result = adapter.mapResponse(false, data, model);
      
      expect(result.thinking).toBe('My thinking process...');
      expect(result.message.content).toBe('Final answer');
    });
  });

  describe('DeepSeek adapter (via openai-like)', () => {
    const adapter = getAdapter('deepseek');

    test('should get correct endpoint', () => {
      const model = { provider: 'deepseek' };
      const endpoint = adapter.getEndpoint(model);
      expect(endpoint).toContain('deepseek.com');
    });

    test('should add thinking_budget parameter', () => {
      const body = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'Hello' }],
        thinking_budget: 32000,
      };
      const model = { model_id: 'deepseek-chat', name: 'deepseek-chat', provider: 'deepseek' };

      const req = adapter.buildRequest(body, model);
      expect(req.thinking_budget).toBe(32000);
    });
  });

  describe('MiniMax adapter (via openai-like)', () => {
    const adapter = getAdapter('minimax');

    test('should get correct endpoint', () => {
      const model = { provider: 'minimax' };
      const endpoint = adapter.getEndpoint(model);
      expect(endpoint).toContain('minimax');
    });
  });
});
