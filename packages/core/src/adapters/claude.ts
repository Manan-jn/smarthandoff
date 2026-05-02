import type { Handoff, AdapterOutput, AdapterOptions } from '../types.js';
import { allocateBudget } from '../compress/budgetAllocator.js';
import { compress } from '../compress/compress.js';
import { estimateTokens } from '../utils.js';

export function toClaude(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'claude', options.tokenBudget);
  const compressed = compress(handoff, budgets);

  const lines: string[] = [];

  lines.push(`## Session resume — ${handoff.createdAt}`);
  lines.push('*(Previous session ended — resuming)*');
  lines.push('');

  const goal = compressed.goals[0];
  if (goal) {
    lines.push(`**Task:** ${goal.title}`);
    lines.push(`**Status:** ${compressed.filesChanged.length} files changed${compressed.blockers.length > 0 ? ', 1 blocker' : ', no blockers'}`);
    lines.push('');
  }

  if (compressed.filesChanged.length > 0) {
    lines.push('**Done:**');
    for (const file of compressed.filesChanged) {
      const icon = file.status === 'added' ? '(new)' : '✓';
      lines.push(`- ${file.path} ${icon}`);
    }
    lines.push('');
  }

  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    lines.push('**Blocked on:**');
    lines.push(b.description);
    if (b.errorMessage) lines.push(`\`${b.errorMessage}\``);
    lines.push('');
  }

  if (compressed.decisions.length > 0) {
    lines.push('**Decisions (do not re-suggest):**');
    for (const d of compressed.decisions) {
      lines.push(`- ${d.summary}`);
    }
    lines.push('');
  }

  if (handoff.notes) {
    lines.push('**Memory fragments:**');
    lines.push(handoff.notes);
    lines.push('');
  }

  if (compressed.nextSteps.length > 0) {
    lines.push(`**Next:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
    if (compressed.context.testCommand) {
      lines.push(`Run: \`${compressed.context.testCommand}\``);
    }
  }

  lines.push('');
  lines.push('*(CLAUDE.md is already on disk — context loaded automatically.)*');

  const text = lines.join('\n');

  return {
    text,
    deliveryMethod: 'clipboard',
    targetTool: 'claude',
    tokenCount: estimateTokens(text),
    launchCommand: `claude`,
  };
}
