import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromClaudeLogs } from '../builders/fromClaudeLogs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

describe('fromClaudeLogs', () => {
  it('parses goal from first user message', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
    expect(result.goals).toBeDefined();
    expect(result.goals!.length).toBeGreaterThan(0);
    expect(result.goals![0].title).toBeTruthy();
    expect(result.goals![0].description).toContain('JWT');
  });

  it('extracts file changes from Write/Edit tool calls', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
    expect(result.filesChanged).toBeDefined();
    expect(result.filesChanged!.some(f => f.path === 'src/auth.ts')).toBe(true);
    expect(result.filesChanged!.some(f => f.path === 'src/tokenRefresh.ts')).toBe(true);
  });

  it('does not include files from Read calls', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
    // Only Write/Edit should be in filesChanged, not Read calls
    expect(result.filesChanged!.length).toBe(2); // auth.ts and tokenRefresh.ts
  });

  it('extracts blocker from last messages', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
    expect(result.blockers).toBeDefined();
    // Last user message mentions an error
    expect(result.blockers!.length).toBeGreaterThan(0);
  });

  it('extracts decisions from pattern matching', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session.jsonl'));
    expect(result.decisions).toBeDefined();
    expect(result.decisions!.length).toBeGreaterThan(0);
    // "rather than embedding it in the JWT" triggers pattern 2
    const decisionTexts = result.decisions!.map(d => d.summary.toLowerCase());
    expect(decisionTexts.some(t => t.includes('deciding') || t.includes('refresh') || t.includes('token'))).toBe(true);
  });

  it('handles short sessions', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-short.jsonl'));
    expect(result.goals).toBeDefined();
    expect(result.goals![0].description).toContain('TypeScript');
  });

  it('handles missing transcript gracefully', async () => {
    const result = await fromClaudeLogs('/nonexistent/path.jsonl');
    expect(result).toEqual({});
  });

  it('extracts error location from last assistant message', async () => {
    const result = await fromClaudeLogs(path.join(FIXTURES, 'sample-session-short.jsonl'));
    // Last assistant message mentions "index.ts:12"
    if (result.blockers && result.blockers.length > 0) {
      const blocker = result.blockers[0];
      expect(blocker.errorLocation).toBe('index.ts:12');
    }
  });
});
