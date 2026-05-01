import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromClaudeLogs } from '../builders/fromClaudeLogs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

describe('fromClaudeLogs', () => {
  describe('goal extraction', () => {
    it('falls back to first user message when no last-prompt events', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.goals).toBeDefined();
      expect(result.goals!.length).toBeGreaterThan(0);
      expect(result.goals![0]!.title).toBeTruthy();
      expect(result.goals![0]!.description).toContain('JWT');
    });

    it('uses last-prompt event text as goal when present', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-compacted.jsonl'));
      expect(result.goals![0]!.description).toContain('rate limiting');
    });
  });

  describe('file extraction', () => {
    it('extracts file changes from Write/Edit tool calls', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.filesChanged).toBeDefined();
      expect(result.filesChanged!.some(f => f.path === 'src/auth.ts')).toBe(true);
      expect(result.filesChanged!.some(f => f.path === 'src/tokenRefresh.ts')).toBe(true);
    });

    it('does not include files from Read calls', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.filesChanged!.length).toBe(2);
    });

    it('last-edit-wins: repeated edits to same file count once', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      const authFiles = result.filesChanged!.filter(f => f.path === 'src/auth.ts');
      expect(authFiles).toHaveLength(1);
    });

    it('filters out-of-project paths when projectRoot is set', async () => {
      const result = await fromClaudeLogs(
        path.join(FIXTURES, 'sample-session.jsonl'),
        { projectRoot: '/some/other/project' }
      );
      expect(result.filesChanged!.length).toBe(0);
    });

    it('keeps relative paths when no projectRoot is set', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.filesChanged!.length).toBeGreaterThan(0);
    });
  });

  describe('compact session (Scenario B)', () => {
    it('extracts sessionSegments from compact_boundary events', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-compacted.jsonl'));
      expect(result.sessionSegments).toBeDefined();
      expect(result.sessionSegments!.length).toBe(1);
      expect(result.sessionSegments![0]!.summary).toContain('JWT auth middleware');
      expect(result.sessionSegments![0]!.gitBranch).toBe('feature/auth');
    });

    it('only processes post-compact events for files changed', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-compacted.jsonl'));
      expect(result.filesChanged!.some(f => f.path === 'src/routes/auth.ts')).toBe(true);
    });
  });

  describe('PR links', () => {
    it('returns no prLinks when no pr-link events', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.prLinks).toBeUndefined();
    });

    it('extracts PR URLs from pr-link events', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-compacted.jsonl'));
      expect(result.prLinks).toBeDefined();
      expect(result.prLinks![0]).toBe('https://github.com/org/repo/pull/42');
    });
  });

  describe('todo tasks as next steps', () => {
    it('uses todo_reminder pending tasks as nextSteps', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-compacted.jsonl'));
      expect(result.nextSteps).toBeDefined();
      expect(result.nextSteps![0]!.description).toBe('Add rate limiting to refresh endpoint');
      expect(result.nextSteps![1]!.description).toBe('Write tests for rate limiter');
      expect(result.nextSteps!.map(s => s.description)).not.toContain('Update CLAUDE.md with auth patterns');
    });
  });

  describe('blockers', () => {
    it('extracts blocker from last messages', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.blockers).toBeDefined();
      expect(result.blockers!.length).toBeGreaterThan(0);
    });
  });

  describe('decisions', () => {
    it('extracts decisions from pattern matching', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
      expect(result.decisions).toBeDefined();
      expect(result.decisions!.length).toBeGreaterThan(0);
      const decisionTexts = result.decisions!.map(d => d.summary.toLowerCase());
      expect(decisionTexts.some(t => t.includes('deciding') || t.includes('refresh') || t.includes('token'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles short sessions', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-short.jsonl'));
      expect(result.goals).toBeDefined();
      expect(result.goals![0]!.description).toContain('TypeScript');
    });

    it('handles missing transcript gracefully', async () => {
      const result = await fromClaudeLogs('/nonexistent/path.jsonl');
      expect(result).toEqual({});
    });

    it('extracts error location from last assistant message', async () => {
      const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-short.jsonl'));
      if (result.blockers && result.blockers.length > 0) {
        const blocker = result.blockers[0]!;
        expect(blocker.errorLocation).toBe('index.ts:12');
      }
    });
  });
});
