import type { Handoff } from '../types.js';
import type { SectionBudgets } from './budgetAllocator.js';
import { estimateTokens } from '../utils.js';
import { compressDiff, compressText } from './compressDiffs.js';

export function compress(handoff: Handoff, budgets: SectionBudgets): Handoff {
  const compressed: Handoff = {
    ...handoff,
    goals: handoff.goals.map(g => ({
      ...g,
      description: compressText(g.description, Math.floor(budgets.goal / Math.max(handoff.goals.length, 1))),
    })),
    decisions: compressDecisions(handoff.decisions, budgets.decisions),
    filesChanged: compressFiles(handoff.filesChanged, budgets.filesChanged),
    blockers: handoff.blockers.map(b => ({
      ...b,
      description: compressText(b.description, Math.floor(budgets.blockers / Math.max(handoff.blockers.length, 1))),
    })),
    nextSteps: handoff.nextSteps.slice(0, 3).map(n => ({
      ...n,
      description: compressText(n.description, Math.floor(budgets.nextSteps / Math.max(handoff.nextSteps.length, 1))),
    })),
    context: {
      ...handoff.context,
      claudeMdContent: budgets.claudeMd > 0
        ? compressText(handoff.context.claudeMdContent || '', budgets.claudeMd)
        : undefined,
    },
  };

  return compressed;
}

function compressDecisions(
  decisions: Handoff['decisions'],
  budget: number
): Handoff['decisions'] {
  if (!decisions.length) return [];

  // Sort by confidence desc, take what fits
  const sorted = [...decisions].sort((a, b) => b.confidence - a.confidence);
  const result = [];
  let remaining = budget;

  for (const decision of sorted) {
    const tokens = estimateTokens(decision.summary);
    if (remaining <= 0) break;
    result.push({
      ...decision,
      summary: compressText(decision.summary, Math.min(tokens, remaining)),
    });
    remaining -= tokens;
  }

  return result;
}

function compressFiles(
  files: Handoff['filesChanged'],
  budget: number
): Handoff['filesChanged'] {
  if (!files.length) return [];

  // Sort by importance
  const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...files].sort((a, b) =>
    (importanceOrder[a.importance] ?? 2) - (importanceOrder[b.importance] ?? 2)
  );

  const result = [];
  let remaining = budget;
  const perFile = Math.floor(budget / sorted.length);

  for (const file of sorted) {
    if (remaining <= 50) break;
    const fileTokens = estimateTokens(JSON.stringify(file));
    const fileBudget = Math.min(fileTokens, perFile, remaining);

    result.push({
      ...file,
      diff: file.diff ? compressDiff(file.diff, Math.floor(fileBudget * 0.7)) : undefined,
      summary: compressText(file.summary, Math.floor(fileBudget * 0.3)),
    });
    remaining -= Math.min(fileTokens, fileBudget);
  }

  return result;
}
