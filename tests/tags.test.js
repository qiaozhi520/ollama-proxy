const { createTestApp, request } = require('./setup');

describe('GET /api/tags', () => {
  let app;
  
  beforeAll(() => {
    app = createTestApp();
  });
  
  test('should return model list', async () => {
    const res = await request(app)
      .get('/api/tags')
      .expect(200);
    
    expect(res.body).toHaveProperty('models');
    expect(Array.isArray(res.body.models)).toBe(true);
  });
  
  test('should have correct model structure', async () => {
    const res = await request(app).get('/api/tags');
    
    if (res.body.models.length > 0) {
      const model = res.body.models[0];
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('model');
      expect(model).toHaveProperty('modified_at');
      expect(model).toHaveProperty('size');
      expect(model).toHaveProperty('digest');
      expect(model).toHaveProperty('details');
    }
  });
  
  test('model name should include :latest tag', async () => {
    const res = await request(app).get('/api/tags');
    
    for (const model of res.body.models) {
      expect(model.name).toMatch(/:latest$/);
      expect(model.model).toMatch(/:latest$/);
    }
  });
});
