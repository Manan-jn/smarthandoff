import type { Handoff, AdapterOutput, AdapterOptions } from '../types.js';
import { allocateBudget } from '../compress/budgetAllocator.js';
import { compress } from '../compress/compress.js';
import { estimateTokens } from '../utils.js';

export function toCursor(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'cursor', options.tokenBudget);
  const compressed = compress(handoff, budgets);

  // MDC rule file
  const mdcLines: string[] = [
    '---',
    'description: Active task handoff from Smart Handoff — delete this file when done',
    'alwaysApply: true',
    '---',
    '',
    '## Active task (delete .cursor/rules/handoff.mdc when done)',
  ];

  const goal = compressed.goals[0];
  mdcLines.push(`**Goal:** ${goal?.title || 'Continue task'}`);
  mdcLines.push('');

  if (compressed.blockers.length > 0) {
    mdcLines.push(`**Blocker:** ${compressed.blockers[0].description}`);
  }

  if (compressed.nextSteps.length > 0) {
    mdcLines.push(`**Next:** ${compressed.nextSteps[0].specificAction || compressed.nextSteps[0].description}`);
  }
  mdcLines.push('');

  if (compressed.filesChanged.length > 0) {
    mdcLines.push('**Changed files (auto-attached):**');
    for (const file of compressed.filesChanged) {
      mdcLines.push(`@${file.path}`);
    }
    mdcLines.push('');
  }

  if (compressed.decisions.length > 0) {
    mdcLines.push('**Decisions made:**');
    for (const d of compressed.decisions) {
      mdcLines.push(`- ${d.summary}`);
    }
    mdcLines.push('');
  }

  if (compressed.context.stack.length > 0) {
    mdcLines.push(`**Stack:** ${compressed.context.stack.join(', ')}`);
    if (compressed.context.testCommand) {
      mdcLines.push(`**Verify:** \`${compressed.context.testCommand}\``);
    }
  }

  const mdcContent = mdcLines.join('\n');

  // Clipboard text (what user pastes in Cursor chat)
  const clipLines: string[] = ['Continue the task. Files are already attached via rules.', ''];
  for (const file of compressed.filesChanged) {
    clipLines.push(`@${file.path}`);
  }
  clipLines.push('');
  clipLines.push(
    compressed.nextSteps[0]?.specificAction ||
    `Fix: ${compressed.blockers[0]?.description || 'continue task'}`
  );
  if (compressed.context.testCommand) {
    clipLines.push(`Verify with: \`${compressed.context.testCommand}\``);
  }

  const clipText = clipLines.join('\n');

  return {
    text: clipText,
    deliveryMethod: 'file-write',
    targetTool: 'cursor',
    tokenCount: estimateTokens(mdcContent),
    filesToWrite: [{
      path: '.cursor/rules/handoff.mdc',
      content: mdcContent,
      isTemporary: true,
    }],
    filesToCleanup: ['.cursor/rules/handoff.mdc'],
  };
}
