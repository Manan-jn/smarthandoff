import type { ClaudeLogEvent } from '../compress/stripNoise.js';
import { extractText } from '../utils.js';

export function findCompactBoundaries(events: ClaudeLogEvent[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'system' && typeof e.preTokens === 'number') {
      indices.push(i);
    }
  }
  return indices;
}

export function extractCompactSummary(events: ClaudeLogEvent[], boundaryIdx: number): string {
  for (let i = boundaryIdx + 1; i < Math.min(boundaryIdx + 5, events.length); i++) {
    const e = events[i]!;
    if (e.type === 'user') {
      const text = extractText(e.message?.content);
      if (text.length > 100) return text;
    }
  }
  return '';
}

export function extractLastPrompts(events: ClaudeLogEvent[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of events) {
    if (e.type === 'last-prompt' && e.lastPrompt && !seen.has(e.lastPrompt)) {
      seen.add(e.lastPrompt);
      result.push(e.lastPrompt);
    }
  }
  return result;
}

export function extractPrLinks(events: ClaudeLogEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type === 'pr-link' && e.url) seen.add(e.url);
  }
  return [...seen];
}

export function extractTodoPendingTasks(events: ClaudeLogEvent[]): string[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'attachment' && e.attachmentType === 'todo_reminder') {
      const items = e.content as Array<{ content: string; status: string }> | undefined;
      if (items?.length) {
        return items
          .filter(t => t.status === 'in_progress' || t.status === 'pending')
          .map(t => t.content);
      }
    }
  }
  return [];
}

export function getCurrentBranch(events: ClaudeLogEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const branch = events[i]!.gitBranch;
    if (branch) return branch;
  }
  return undefined;
}
