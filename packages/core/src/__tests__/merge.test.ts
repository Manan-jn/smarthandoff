import { describe, it, expect } from 'vitest';
import { merge } from '../builders/merge.js';
import type { Handoff } from '../types.js';

const META = { projectRoot: '/test', createdBy: 'test@host' };

describe('merge', () => {
  it('generates a stable ID', () => {
    const result = merge([], META);
    expect(result.id).toMatch(/^shoff_\d+_manual$/);
  });

  it('merges goals from multiple partials', () => {
    const partials: Partial<Handoff>[] = [
      { goals: [{ id: 'g1', title: 'Goal 1', description: 'desc', status: 'in_progress' }] },
      { goals: [{ id: 'g2', title: 'Goal 2', description: 'desc2', status: 'in_progress' }] },
    ];
    const result = merge(partials, META);
    expect(result.goals).toHaveLength(2);
  });

  it('deduplicates files by path — git data wins', () => {
    const partials: Partial<Handoff>[] = [
      {
        filesChanged: [{
          path: 'src/auth.ts', status: 'modified', summary: 'from logs',
          importance: 'medium', linesAdded: 0, linesRemoved: 0,
        }],
      },
      {
        filesChanged: [{
          path: 'src/auth.ts', status: 'modified', summary: 'from git',
          importance: 'critical', linesAdded: 42, linesRemoved: 5,
        }],
      },
    ];
    const result = merge(partials, META);
    expect(result.filesChanged).toHaveLength(1);
    expect(result.filesChanged[0].linesAdded).toBe(42); // git data wins
  });

  it('merges files from different paths', () => {
    const partials: Partial<Handoff>[] = [
      {
        filesChanged: [
          { path: 'a.ts', status: 'added', summary: '', importance: 'medium', linesAdded: 10, linesRemoved: 0 },
          { path: 'b.ts', status: 'modified', summary: '', importance: 'low', linesAdded: 2, linesRemoved: 1 },
        ],
      },
    ];
    const result = merge(partials, META);
    expect(result.filesChanged).toHaveLength(2);
  });

  it('deduplicates stack entries', () => {
    const partials: Partial<Handoff>[] = [
      { context: { stack: ['TypeScript', 'Node'] } },
      { context: { stack: ['TypeScript', 'Express'] } },
    ];
    const result = merge(partials, META);
    const tsCount = result.context.stack.filter(s => s === 'TypeScript').length;
    expect(tsCount).toBe(1);
  });

  it('calculates rawTokenCount', () => {
    const result = merge([], META);
    expect(result.rawTokenCount).toBeGreaterThan(0);
  });

  it('calculates extractionConfidence', () => {
    const partials: Partial<Handoff>[] = [
      { goals: [{ id: 'g1', title: 'Fix bug', description: 'desc', status: 'in_progress' }] },
      { filesChanged: [{ path: 'a.ts', status: 'modified', summary: '', importance: 'medium', linesAdded: 1, linesRemoved: 0 }] },
    ];
    const result = merge(partials, META);
    expect(result.extractionConfidence).toBeGreaterThan(0);
    expect(result.extractionConfidence).toBeLessThanOrEqual(1);
  });

  it('concatenates notes', () => {
    const partials: Partial<Handoff>[] = [
      { notes: 'first note' },
      { notes: 'second note' },
    ];
    const result = merge(partials, META);
    expect(result.notes).toContain('first note');
    expect(result.notes).toContain('second note');
  });
});
