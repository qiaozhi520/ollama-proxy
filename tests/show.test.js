const { createTestApp, request } = require('./setup');

describe('POST /api/show', () => {
  let app;
  
  beforeAll(() => {
    app = createTestApp();
  });
  
  test('should return 400 when no model specified and no fallback available', async () => {
    // 测试环境没有配置模型时，应该返回 400
    const res = await request(app)
      .post('/api/show')
      .send({})
      .expect(400);
    
    expect(res.body).toHaveProperty('error');
  });
  
  test('should return 404 for non-existent model', async () => {
    const res = await request(app)
      .post('/api/show')
      .send({ model: 'non-existent-model:latest' })
      .expect(404);
    
    expect(res.body).toHaveProperty('error');
  });
  
  test('should accept name parameter (Continue extension compatibility)', async () => {
    const res = await request(app)
      .post('/api/show')
      .send({ name: 'non-existent-model:latest' })
      .expect(404);
    
    // 测试参数兼容性，模型不存在返回 404 是正常的
    expect(res.body).toHaveProperty('error');
  });
});
