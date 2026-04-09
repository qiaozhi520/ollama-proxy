'use strict';

function stripThinkingMarkup(text) {
  const source = typeof text === 'string' ? text : '';
  const thinkingParts = [];

  const content = source
    .replace(/<think(?:ing)?[^>]*>([\s\S]*?)<\/think(?:ing)?>/gi, (_match, thinkingBlock) => {
      if (thinkingBlock) {
        thinkingParts.push(String(thinkingBlock).trim());
      }
      return '';
    })
    .trim();

  const thinking = thinkingParts.join('\n').trim();

  return {
    content,
    thinking: thinking || undefined,
  };
}

function extractThinkingContent(message = {}, chunk = {}) {
  const explicitThinking = message.thinking || message.thinking_content || chunk.thinking;
  const contentResult = stripThinkingMarkup(message.content);

  return {
    content: contentResult.content,
    thinking: explicitThinking || contentResult.thinking,
  };
}

class StreamingThinkingProcessor {
  constructor() {
    this.buffer = '';
    this.inThinking = false;
    this.thinkingBuffer = '';
    this.pendingContent = '';  // 待发送的内容
  }

  process(content) {
    if (!content) return { content: '', thinking: '' };
    
    this.buffer += content;
    let outputContent = '';
    let outputThinking = '';
    
    while (this.buffer.length > 0) {
      if (this.inThinking) {
        // 在思考标签内，查找结束标签
        const endIdx = this.buffer.indexOf('</think' + '>');
        if (endIdx !== -1) {
          // 找到结束标签，累积思考内容
          this.thinkingBuffer += this.buffer.substring(0, endIdx);
          this.buffer = this.buffer.substring(endIdx + 8);
          this.inThinking = false;
          outputThinking = this.thinkingBuffer;
          this.thinkingBuffer = '';
        } else {
          // 没找到结束标签，需要继续缓冲
          // 先检查是否有待发送的内容
          if (this.buffer.length > 6) {
            // 可能结束标签被截断，保留最后6个字符
            const safeLength = this.buffer.length - 6;
            this.thinkingBuffer += this.buffer.substring(0, safeLength);
            this.buffer = this.buffer.substring(safeLength);
          }
          break;
        }
      } else {
        // 不在思考标签内，查找开始标签
        const startIdx = this.buffer.indexOf('<think' + '>');
        if (startIdx !== -1) {
          // 找到开始标签
          if (startIdx > 0) {
            // 输出开始标签之前的内容
            outputContent += this.buffer.substring(0, startIdx);
          }
          this.buffer = this.buffer.substring(startIdx + 7);
          this.inThinking = true;
        } else {
          // 没找到开始标签
          // 检查是否可能标签被截断（保留最后6个字符）
          if (this.buffer.length > 6) {
            const safeLength = this.buffer.length - 6;
            outputContent += this.buffer.substring(0, safeLength);
            this.buffer = this.buffer.substring(safeLength);
          }
          break;
        }
      }
    }
    
    return { content: outputContent, thinking: outputThinking };
  }

  flush() {
    let outputContent = this.buffer;
    let outputThinking = this.thinkingBuffer;
    
    this.reset();
    return { content: outputContent, thinking: outputThinking };
  }

  reset() {
    this.buffer = '';
    this.inThinking = false;
    this.thinkingBuffer = '';
    this.pendingContent = '';
  }
}

module.exports = {
  stripThinkingMarkup,
  extractThinkingContent,
  StreamingThinkingProcessor,
};
