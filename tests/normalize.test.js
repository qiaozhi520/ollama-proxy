// 测试模型名规范化逻辑
function normalizeModelName(name) {
  if (!name) return name;
  return name.split(':')[0];
}

// 测试 thinking 内容转换逻辑
function convertThinkingToContent(message) {
  const content = typeof message.content === 'string' ? message.content : '';
  const thinkingContent = message.thinking || message.thinking_content;
  if (thinkingContent) {
    const thinkingPrefix = `<thinking>\n${thinkingContent}\n</thinking>\n`;
    return thinkingPrefix + content;
  }
  return content;
}

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

describe('convertThinkingToContent', () => {
  test('should add thinking tag before content', () => {
    const result = convertThinkingToContent({
      content: 'Hello',
      thinking: 'I am thinking...'
    });
    expect(result).toBe('<thinking>\nI am thinking...\n</thinking>\nHello');
  });
  
  test('should handle thinking_content field', () => {
    const result = convertThinkingToContent({
      content: 'Hello',
      thinking_content: 'I am thinking...'
    });
    expect(result).toBe('<thinking>\nI am thinking...\n</thinking>\nHello');
  });
  
  test('should handle no thinking', () => {
    const result = convertThinkingToContent({
      content: 'Hello'
    });
    expect(result).toBe('Hello');
  });
  
  test('should handle empty thinking', () => {
    const result = convertThinkingToContent({
      content: 'Hello',
      thinking: ''
    });
    expect(result).toBe('Hello');
  });
});
