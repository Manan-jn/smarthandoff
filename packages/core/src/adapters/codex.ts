import type { Handoff, AdapterOutput, AdapterOptions } from '../types.js';
import { allocateBudget } from '../compress/budgetAllocator.js';
import { compress } from '../compress/compress.js';
import { estimateTokens } from '../utils.js';
import path from 'node:path';

export function toCodex(handoff: Handoff, options: AdapterOptions = {}): AdapterOutput {
  const budgets = allocateBudget(handoff, 'codex', options.tokenBudget);
  const compressed = compress(handoff, budgets);

  const lines: string[] = [];

  // Codex prefers flat, command-like format
  const goal = compressed.goals[0];
  lines.push(`TASK: ${goal?.title || 'Continue coding task'}`);

  // Files — exact paths
  for (const file of compressed.filesChanged) {
    lines.push(`FILE: ${file.path} (${file.status})`);
  }

  // Blocker — most prominent for Codex
  if (compressed.blockers.length > 0) {
    const b = compressed.blockers[0];
    if (b.errorLocation) {
      lines.push(`FAILING: ${b.errorLocation}`);
      lines.push(`  Error: ${b.errorMessage || b.description}`);
    } else {
      lines.push(`BLOCKER: ${b.description}`);
    }
    if (b.suggestedNextSteps) {
      lines.push(`HYPOTHESIS: ${b.suggestedNextSteps}`);
    }
  }

  // Verify command
  if (compressed.context.testCommand) {
    lines.push(`VERIFY: ${compressed.context.testCommand}`);
  }

  // Decisions
  if (compressed.decisions.length > 0) {
    lines.push(`DECISIONS: ${compressed.decisions.map(d => d.summary).join('; ')}`);
  }

  // Stack
  if (compressed.context.stack.length > 0) {
    lines.push(`STACK: ${compressed.context.stack.join(', ')}`);
  }

  // Safety scope constraint
  const changedDirs = compressed.filesChanged
    .map(f => path.dirname(f.path))
    .filter(d => d !== '.');
  const uniqueDirs = [...new Set(changedDirs)].slice(0, 3);
  if (uniqueDirs.length > 0) {
    lines.push(`SCOPE: Do not change files outside ${uniqueDirs.join(', ')}`);
  }

  const text = lines.join('\n');

  // AGENTS.md temporary patch
  const agentsPatch = [
    '',
    '## ACTIVE TASK (from smart-handoff — delete after done)',
    `Goal: ${goal?.title || 'Continue task'}`,
    compressed.blockers[0] ? `Blocker: ${compressed.blockers[0].description}` : '',
    compressed.context.testCommand ? `Verify: ${compressed.context.testCommand}` : '',
    '',
  ].filter(l => l !== undefined).join('\n');

  return {
    text,
    deliveryMethod: 'pipe',
    targetTool: 'codex',
    tokenCount: estimateTokens(text),
    filesToWrite: [{
      path: 'AGENTS.md',
      content: agentsPatch,
      isTemporary: true,
    }],
    filesToCleanup: ['AGENTS.md'],
    launchCommand: `codex`,
  };
}
