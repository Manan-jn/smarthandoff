import { describe, it, expect } from 'vitest';
import { toClaude, toGeneric } from '../adapters/index.js';
import type { Handoff } from '../types.js';

const SAMPLE_HANDOFF: Handoff = {
  id: 'shoff_test',
  projectRoot: '/test/project',
  createdAt: '2026-04-27T10:00:00Z',
  createdBy: 'tester@host',
  mode: 'rich',
  goals: [{
    id: 'g1',
    title: 'Build JWT refresh middleware',
    description: 'Build a JWT refresh middleware for Express.',
    status: 'in_progress',
  }],
  decisions: [{
    id: 'd1',
    summary: 'Decided to use a separate refresh token table for server-side invalidation',
    rationale: 'Allows invalidating tokens server-side',
    timestamp: '2026-04-27T10:00:05Z',
    confidence: 0.8,
  }],
  filesChanged: [
    { path: 'src/auth.ts', status: 'modified', summary: 'Added refreshToken function', importance: 'critical', linesAdded: 10, linesRemoved: 2 },
    { path: 'src/tokenRefresh.ts', status: 'added', summary: 'New route handler', importance: 'high', linesAdded: 8, linesRemoved: 0 },
  ],
  blockers: [{
    id: 'b1',
    description: 'auth.test.ts:84 failing with Cannot read property findOne',
    severity: 'high',
    errorMessage: "Cannot read property 'findOne' of undefined",
    errorLocation: 'auth.test.ts:84',
  }],
  nextSteps: [{
    id: 'n1',
    description: 'Add jest.mock for db module',
    priority: 'high',
    specificAction: 'Add jest.mock for the db module at the top of auth.test.ts',
  }],
  context: {
    stack: ['TypeScript', 'Express', 'Node v20'],
    testCommand: 'npm test',
    claudeMdContent: '# Project\nThis is a TypeScript Express project.',
  },
  sources: [{ tool: 'claude-code', collectedAt: '2026-04-27T10:00:00Z' }],
  extractionConfidence: 0.85,
  rawTokenCount: 5000,
};

describe('toClaude', () => {
  it('produces clipboard delivery method', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.deliveryMethod).toBe('clipboard');
    expect(output.targetTool).toBe('claude');
  });

  it('includes task title', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.text).toContain('JWT refresh middleware');
  });

  it('includes file paths', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.text).toContain('src/auth.ts');
  });

  it('includes blocker description', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.text).toContain('auth.test.ts:84');
  });

  it('does NOT include CLAUDE.md content (already on disk)', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    // Claude adapter never includes claudeMd (budget is 0)
    expect(output.text).not.toContain('# Project\nThis is a TypeScript Express project.');
  });

  it('token count is within claude budget', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.tokenCount).toBeLessThanOrEqual(15_000);
  });

  it('includes next step', () => {
    const output = toClaude(SAMPLE_HANDOFF);
    expect(output.text).toContain('jest.mock');
  });
});

describe('toGeneric', () => {
  it('produces clipboard delivery method', () => {
    const output = toGeneric(SAMPLE_HANDOFF);
    expect(output.deliveryMethod).toBe('clipboard');
    expect(output.targetTool).toBe('generic');
  });

  it('has a markdown header', () => {
    const output = toGeneric(SAMPLE_HANDOFF);
    expect(output.text).toContain('# AI Session Handoff');
  });

  it('includes all main sections', () => {
    const output = toGeneric(SAMPLE_HANDOFF);
    expect(output.text).toContain('## Goal');
    expect(output.text).toContain('## Files Changed');
    expect(output.text).toContain('## Current Blocker');
    expect(output.text).toContain('## Decisions Made');
    expect(output.text).toContain('## Next Step');
  });

  it('token count is within generic budget', () => {
    const output = toGeneric(SAMPLE_HANDOFF);
    expect(output.tokenCount).toBeLessThanOrEqual(10_000);
  });
});
