import type { Handoff, TargetTool } from '../types.js';
import { estimateTokens } from '../utils.js';

export const TOOL_BUDGETS: Record<TargetTool, number> = {
  gemini:  50_000,
  codex:    8_000,
  cursor:  20_000,
  claude:  15_000,
  chatgpt: 20_000,
  generic: 10_000,
};

export interface SectionBudgets {
  goal: number;
  decisions: number;
  filesChanged: number;
  blockers: number;
  nextSteps: number;
  context: number;
  claudeMd: number;
}

export function allocateBudget(
  handoff: Handoff,
  target: TargetTool,
  overrideBudget?: number
): SectionBudgets {
  const totalBudget = overrideBudget ?? TOOL_BUDGETS[target];

  const FIXED = {
    goal:      400,
    blockers:  300,
    nextSteps: 200,
  };
  const fixedTotal = FIXED.goal + FIXED.blockers + FIXED.nextSteps;
  const remaining = totalBudget - fixedTotal;

  if (target === 'codex') {
    return {
      ...FIXED,
      decisions:    Math.floor(remaining * 0.15),
      filesChanged: Math.floor(remaining * 0.60),
      context:      Math.floor(remaining * 0.20),
      claudeMd:     0,
    };
  }

  if (target === 'claude') {
    return {
      ...FIXED,
      decisions:    Math.floor(remaining * 0.30),
      filesChanged: Math.floor(remaining * 0.40),
      context:      Math.floor(remaining * 0.30),
      claudeMd:     0,
    };
  }

  if (target === 'gemini') {
    const claudeMdTokens = estimateTokens(handoff.context.claudeMdContent || '');
    return {
      ...FIXED,
      decisions:    Math.floor(remaining * 0.20),
      filesChanged: Math.floor(remaining * 0.35),
      context:      Math.floor(remaining * 0.15),
      claudeMd:     Math.min(claudeMdTokens, Math.floor(remaining * 0.30)),
    };
  }

  // Default: cursor, chatgpt, generic
  return {
    ...FIXED,
    decisions:    Math.floor(remaining * 0.25),
    filesChanged: Math.floor(remaining * 0.40),
    context:      Math.floor(remaining * 0.25),
    claudeMd:     Math.floor(remaining * 0.10),
  };
}
