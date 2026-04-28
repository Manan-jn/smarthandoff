import type { Handoff, AdapterOutput, AdapterOptions } from '../types.js';
import { allocateBudget } from '../compress/budgetAllocator.js';
import { compress } from '../compress/compress.js';
import { estimateTokens } from '../utils.js';

export function toGeneric(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'generic', options.tokenBudget);
  const compressed = compress(handoff, budgets);

  const lines: string[] = [];

  lines.push('# AI Session Handoff');
  lines.push(`*Generated: ${handoff.createdAt}*`);
  lines.push('');

  const goal = compressed.goals[0];
  if (goal) {
    lines.push('## Goal');
    lines.push(`**${goal.title}**`);
    if (goal.description !== goal.title) lines.push(goal.description);
    lines.push('');
  }

  if (compressed.filesChanged.length > 0) {
    lines.push('## Files Changed');
    for (const file of compressed.filesChanged) {
      lines.push(`- \`${file.path}\` (${file.status})`);
      if (file.summary) lines.push(`  ${file.summary}`);
    }
    lines.push('');
  }

  if (compressed.blockers.length > 0) {
    lines.push('## Current Blocker');
    const b = compressed.blockers[0];
    lines.push(b.description);
    if (b.errorMessage) lines.push(`\nError: \`${b.errorMessage}\``);
    if (b.errorLocation) lines.push(`Location: ${b.errorLocation}`);
    lines.push('');
  }

  if (compressed.decisions.length > 0) {
    lines.push('## Decisions Made');
    for (const d of compressed.decisions) {
      lines.push(`- ${d.summary}`);
    }
    lines.push('');
  }

  if (compressed.nextSteps.length > 0) {
    lines.push('## Next Step');
    lines.push(compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description);
    lines.push('');
  }

  if (compressed.context.stack.length > 0) {
    lines.push('## Stack');
    lines.push(compressed.context.stack.join(', '));
    if (compressed.context.testCommand) {
      lines.push(`Test: \`${compressed.context.testCommand}\``);
    }
    lines.push('');
  }

  if (compressed.context.claudeMdContent && budgets.claudeMd > 0) {
    lines.push('## Project Instructions');
    lines.push(compressed.context.claudeMdContent);
    lines.push('');
  }

  const text = lines.join('\n');

  return {
    text,
    deliveryMethod: 'clipboard',
    targetTool: 'generic',
    tokenCount: estimateTokens(text),
  };
}
