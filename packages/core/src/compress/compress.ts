import type { Handoff, HandoffSessionSegment } from '../types.js';
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

  // Compress session history: trim oldest segments first if over budget
  if (handoff.sessionSegments?.length) {
    compressed.sessionSegments = compressSessionSegments(
      handoff.sessionSegments,
      budgets.sessionHistory
    );
  }

  // Compress goal progression: keep first + last N items to preserve arc
  if (handoff.goalProgression?.length) {
    compressed.goalProgression = compressGoalProgression(
      handoff.goalProgression,
      budgets.goalProgression
    );
  }

  return compressed;
}

function compressDecisions(
  decisions: Handoff['decisions'],
  budget: number
): Handoff['decisions'] {
  if (!decisions.length) return [];

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

    if (fileTokens <= perFile && fileTokens <= remaining) {
      result.push(file);
      remaining -= fileTokens;
      continue;
    }

    const fileBudget = Math.min(perFile, remaining);
    const summaryTokens = estimateTokens(file.summary);
    const diffBudget = Math.max(0, fileBudget - summaryTokens - 20);

    result.push({
      ...file,
      diff: file.diff ? compressDiff(file.diff, diffBudget) : undefined,
      summary: compressText(file.summary, Math.min(summaryTokens, fileBudget - 20)),
    });
    remaining -= fileBudget;
  }

  return result;
}

function compressSessionSegments(
  segments: HandoffSessionSegment[],
  budget: number
): HandoffSessionSegment[] {
  if (budget <= 0) return [];

  // Trim oldest segments first — most recent history is most relevant
  const result: HandoffSessionSegment[] = [];
  let remaining = budget;

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    const tokens = estimateTokens(seg.summary);
    if (remaining <= 0) break;
    result.unshift({
      ...seg,
      summary: compressText(seg.summary, Math.min(tokens, remaining)),
    });
    remaining -= tokens;
  }

  return result;
}

function compressGoalProgression(goals: string[], budget: number): string[] {
  if (budget <= 0) return [];
  if (goals.length <= 1) return goals;

  const result: string[] = [];
  let remaining = budget;

  // Always include first goal (original intent)
  const firstTokens = estimateTokens(goals[0]!);
  if (firstTokens <= remaining) {
    result.push(goals[0]!);
    remaining -= firstTokens;
  }

  // Fill from most recent backwards
  for (let i = goals.length - 1; i >= 1; i--) {
    const tokens = estimateTokens(goals[i]!);
    if (remaining <= 0) break;
    result.splice(1, 0, goals[i]!);
    remaining -= tokens;
  }

  return result;
}
