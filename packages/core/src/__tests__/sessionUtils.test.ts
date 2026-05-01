import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import type { ClaudeLogEvent } from '../compress/stripNoise.js';
import {
  findCompactBoundaries,
  extractCompactSummary,
  extractLastPrompts,
  extractPrLinks,
  extractTodoPendingTasks,
  getCurrentBranch,
} from '../builders/sessionUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

async function loadFixture(name: string): Promise<ClaudeLogEvent[]> {
  const raw = await fs.readFile(path.join(FIXTURES, name), 'utf8');
  return raw.trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as ClaudeLogEvent; } catch { return null; } })
    .filter((e): e is ClaudeLogEvent => e !== null);
}

describe('findCompactBoundaries', () => {
  it('returns empty array when no compact boundaries', async () => {
    const events = await loadFixture('sample-session.jsonl');
    expect(findCompactBoundaries(events)).toEqual([]);
  });

  it('returns index of compact_boundary system event', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    const boundaries = findCompactBoundaries(events);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toBe(0);
  });
});

describe('extractCompactSummary', () => {
  it('returns text of user message immediately after boundary', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    const boundaries = findCompactBoundaries(events);
    const summary = extractCompactSummary(events, boundaries[0]!);
    expect(summary).toContain('JWT auth middleware');
    expect(summary).toContain('refreshToken');
  });
});

describe('extractLastPrompts', () => {
  it('returns empty array when no last-prompt events', async () => {
    const events = await loadFixture('sample-session.jsonl');
    expect(extractLastPrompts(events)).toEqual([]);
  });

  it('returns lastPrompt strings from last-prompt events', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    const prompts = extractLastPrompts(events);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toBe('Add rate limiting to the refresh token endpoint');
  });
});

describe('extractPrLinks', () => {
  it('returns empty array when no pr-link events', async () => {
    const events = await loadFixture('sample-session.jsonl');
    expect(extractPrLinks(events)).toEqual([]);
  });

  it('returns deduplicated PR URLs', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    const links = extractPrLinks(events);
    expect(links).toHaveLength(1);
    expect(links[0]).toBe('https://github.com/org/repo/pull/42');
  });
});

describe('extractTodoPendingTasks', () => {
  it('returns empty array when no todo_reminder attachment', async () => {
    const events = await loadFixture('sample-session.jsonl');
    expect(extractTodoPendingTasks(events)).toEqual([]);
  });

  it('returns only in_progress and pending tasks', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    const tasks = extractTodoPendingTasks(events);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBe('Add rate limiting to refresh endpoint');
    expect(tasks[1]).toBe('Write tests for rate limiter');
    expect(tasks).not.toContain('Update CLAUDE.md with auth patterns');
  });
});

describe('getCurrentBranch', () => {
  it('returns undefined when no events have gitBranch', async () => {
    const events = await loadFixture('sample-session.jsonl');
    expect(getCurrentBranch(events)).toBeUndefined();
  });

  it('returns most recent gitBranch value', async () => {
    const events = await loadFixture('sample-session-compacted.jsonl');
    expect(getCurrentBranch(events)).toBe('feature/auth');
  });
});
