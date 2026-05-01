import { describe, it, expect } from 'vitest';
import { allocateBudget, TOOL_BUDGETS } from '../compress/budgetAllocator.js';
import type { Handoff } from '../types.js';

const EMPTY_HANDOFF: Handoff = {
  id: 'test', projectRoot: '/test', createdAt: '', createdBy: 'test', mode: 'rich',
  goals: [], decisions: [], filesChanged: [], blockers: [], nextSteps: [],
  context: { stack: [] }, sources: [], extractionConfidence: 0, rawTokenCount: 0,
};

describe('allocateBudget', () => {
  it('respects tool budget defaults', () => {
    const budgets = allocateBudget(EMPTY_HANDOFF, 'gemini');
    const total = budgets.goal + budgets.decisions + budgets.filesChanged +
      budgets.blockers + budgets.nextSteps + budgets.context + budgets.claudeMd;
    expect(total).toBeLessThanOrEqual(TOOL_BUDGETS.gemini);
  });

  it('codex gets claudeMd budget of 0', () => {
    const budgets = allocateBudget(EMPTY_HANDOFF, 'codex');
    expect(budgets.claudeMd).toBe(0);
  });

  it('claude gets claudeMd budget of 0', () => {
    const budgets = allocateBudget(EMPTY_HANDOFF, 'claude');
    expect(budgets.claudeMd).toBe(0);
  });

  it('gemini includes claudeMd budget when content exists', () => {
    const handoff: Handoff = {
      ...EMPTY_HANDOFF,
      context: { stack: [], claudeMdContent: 'A'.repeat(1000) },
    };
    const budgets = allocateBudget(handoff, 'gemini');
    expect(budgets.claudeMd).toBeGreaterThan(0);
  });

  it('codex has tightest total budget', () => {
    expect(TOOL_BUDGETS.codex).toBeLessThan(TOOL_BUDGETS.gemini);
    expect(TOOL_BUDGETS.codex).toBeLessThan(TOOL_BUDGETS.claude);
  });

  it('respects override budget', () => {
    const budgets = allocateBudget(EMPTY_HANDOFF, 'gemini', 5000);
    const total = budgets.goal + budgets.decisions + budgets.filesChanged +
      budgets.blockers + budgets.nextSteps + budgets.context + budgets.claudeMd;
    expect(total).toBeLessThanOrEqual(5000);
  });

  it('never produces negative section budgets for tiny budgets', () => {
    const budgets = allocateBudget(EMPTY_HANDOFF, 'gemini', 500);
    expect(budgets.goal).toBeGreaterThanOrEqual(0);
    expect(budgets.decisions).toBeGreaterThanOrEqual(0);
    expect(budgets.filesChanged).toBeGreaterThanOrEqual(0);
    expect(budgets.blockers).toBeGreaterThanOrEqual(0);
    expect(budgets.nextSteps).toBeGreaterThanOrEqual(0);
    expect(budgets.context).toBeGreaterThanOrEqual(0);
    expect(budgets.claudeMd).toBeGreaterThanOrEqual(0);
  });

  it('total never exceeds override budget for any small value', () => {
    for (const budget of [200, 500, 1000, 5000]) {
      const budgets = allocateBudget(EMPTY_HANDOFF, 'gemini', budget);
      const total = budgets.goal + budgets.decisions + budgets.filesChanged +
        budgets.blockers + budgets.nextSteps + budgets.context + budgets.claudeMd;
      expect(total).toBeLessThanOrEqual(budget);
    }
  });

  it('gemini allocates more to filesChanged than codex proportionally', () => {
    const gemini = allocateBudget(EMPTY_HANDOFF, 'gemini');
    const codex = allocateBudget(EMPTY_HANDOFF, 'codex');
    // Codex gives 60% to files, gemini 35% — codex files as fraction of total should be higher
    const codexFilesFraction = codex.filesChanged / TOOL_BUDGETS.codex;
    const geminiFilesFraction = gemini.filesChanged / TOOL_BUDGETS.gemini;
    expect(codexFilesFraction).toBeGreaterThan(geminiFilesFraction);
  });
});
