const chatRoute = require('../src/routes/chat');

const {
  normalizeModelName,
  stripThinkingMarkup,
  convertOllamaMessageToOpenAIMessage,
  sanitizeOllamaResponse,
} = chatRoute;

describe('normalizeModelName', () => {
  test('should remove :latest tag', () => {
    expect(normalizeModelName('deepseek/deepseek-chat:latest'))
      .toBe('deepseek/deepseek-chat');
  });
  
  test('should remove other tags', () => {
    expect(normalizeModelName('llama3:8b')).toBe('llama3');
  });
  
  test('should keep name without tag', () => {
    expect(normalizeModelName('deepseek/deepseek-chat'))
      .toBe('deepseek/deepseek-chat');
  });
  
  test('should handle empty string', () => {
    expect(normalizeModelName('')).toBe('');
  });
  
  test('should handle null/undefined', () => {
    expect(normalizeModelName(null)).toBe(null);
    expect(normalizeModelName(undefined)).toBe(undefined);
  });
});

describe('thinking markup handling', () => {
  test('should strip wrapped think blocks from content', () => {
    const result = stripThinkingMarkup('<think> I am thinking... </think>Hello');

    expect(result.content).toBe('Hello');
    expect(result.thinking).toBe('I am thinking...');
  });

  test('should keep thinking separate from visible content', () => {
    const result = convertOllamaMessageToOpenAIMessage({
      content: 'Hello',
      thinking: 'I am thinking...'
    });

    expect(result.content).toBe('Hello');
    expect(result.thinking).toBe('I am thinking...');
    expect(result.content).not.toContain('<thinking>');
    expect(result.content).not.toContain('<think>');
  });

  test('should remove embedded think tags from content when no explicit thinking field exists', () => {
    const result = convertOllamaMessageToOpenAIMessage({
      content: '<thinking> I am thinking... </thinking>Hello'
    });

    expect(result.content).toBe('Hello');
    expect(result.thinking).toBe('I am thinking...');
  });

  test('should sanitize ollama responses before sending to clients', () => {
    const response = sanitizeOllamaResponse({
      model: 'test-model',
      message: {
        role: 'assistant',
        content: '<think> I am thinking... </think>Hello',
      },
    });

    expect(response.message.content).toBe('Hello');
    expect(response.thinking).toBe('I am thinking...');
  });
});
