const { createTestApp, request } = require('./setup');

describe('GET /api/version', () => {
  let app;
  
  beforeAll(() => {
    app = createTestApp();
  });
  
  test('should return version info', async () => {
    const res = await request(app)
      .get('/api/version')
      .expect(200);
    
    expect(res.body).toHaveProperty('version');
  });
});
