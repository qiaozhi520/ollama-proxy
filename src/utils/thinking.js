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

module.exports = {
  stripThinkingMarkup,
  extractThinkingContent,
};