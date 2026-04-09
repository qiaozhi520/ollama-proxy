// 测试模型名规范化逻辑
function normalizeModelName(name) {
  if (!name) return name;
  return name.split(':')[0];
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
