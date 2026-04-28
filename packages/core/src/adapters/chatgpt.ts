import type { Handoff, AdapterOutput, AdapterOptions } from '../types.js';
import { allocateBudget } from '../compress/budgetAllocator.js';
import { compress } from '../compress/compress.js';
import { estimateTokens } from '../utils.js';

export function toChatGPT(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'chatgpt', options.tokenBudget);
  const compressed = compress(handoff, budgets);

  // Part 1: System prompt
  const systemParts: string[] = [
    'You are a senior software engineer continuing work from an AI coding session.',
  ];
  if (compressed.context.stack.length > 0) {
    systemParts.push(`Stack: ${compressed.context.stack.join(', ')}.`);
  }
  systemParts.push('Follow existing patterns. Do not refactor what is already working. Ask clarifying questions only if essential.');
  const systemPrompt = systemParts.join(' ');

  // Part 2: First message
  const msgLines: string[] = [
    "I'm continuing a coding session. Rate limit hit on Claude, switching to you.",
    '',
  ];

  const goal = compressed.goals[0];
  msgLines.push(`**What we were building:** ${goal?.description || goal?.title || 'Continue task'}`);
  msgLines.push('');

  if (compressed.filesChanged.length > 0) {
    msgLines.push('**Files already changed:**');
    for (const file of compressed.filesChanged) {
      msgLines.push(`- \`${file.path}\` — ${file.summary || file.status}`);
    }
    msgLines.push('');
  }

  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    msgLines.push('**Current blocker:**');
    if (b.errorLocation) msgLines.push(`${b.errorLocation} fails:`);
    msgLines.push(b.description);
    if (b.errorMessage) msgLines.push(`\`\`\`\n${b.errorMessage}\n\`\`\``);
    msgLines.push('');
  }

  if (compressed.decisions.length > 0) {
    msgLines.push('**Decisions already made — do not re-suggest:**');
    for (const d of compressed.decisions) {
      msgLines.push(`- ${d.summary}`);
    }
    msgLines.push('');
  }

  if (compressed.nextSteps.length > 0) {
    msgLines.push(`**Please:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
  }

  const messageText = msgLines.join('\n');

  return {
    text: messageText,
    systemPrompt,
    deliveryMethod: 'two-part-clipboard',
    targetTool: 'chatgpt',
    tokenCount: estimateTokens(`${systemPrompt}\n\n${messageText}`),
  };
}
