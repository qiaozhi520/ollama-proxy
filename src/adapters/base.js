'use strict';

/**
 * 基础适配器类
 * 定义适配器接口，所有 provider 适配器都应继承此类
 */
class BaseAdapter {
  constructor() {
    this.name = 'base';
  }

  /**
   * 获取 API 端点
   */
  getEndpoint(cfg) {
    throw new Error('getEndpoint() must be implemented');
  }

  /**
   * 构建请求体
   */
  buildRequest(body, cfg) {
    // 默认直接返回原始请求体
    return body;
  }

  /**
   * 映射响应（用于流式和非流式）
   */
  mapResponse(isStream, data, cfg) {
    return data;
  }

  /**
   * 获取 Authorization header
   */
  getAuthHeader(apiKey) {
    return `Bearer ${apiKey}`;
  }
}

module.exports = BaseAdapter;
