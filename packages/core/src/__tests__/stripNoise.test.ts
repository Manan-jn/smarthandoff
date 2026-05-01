import { describe, it, expect } from 'vitest';
import { stripNoise, type ClaudeLogEvent } from '../compress/stripNoise.js';

describe('stripNoise', () => {
  it('removes tool_result events', () => {
    const events: ClaudeLogEvent[] = [
      { type: 'user', message: { content: 'hello' } },
      { type: 'tool_result', message: { content: 'file contents...' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } },
    ];
    const result = stripNoise(events);
    expect(result).toHaveLength(2);
    expect(result.every(e => e.type !== 'tool_result')).toBe(true);
  });

  it('keeps user and assistant messages', () => {
    const events: ClaudeLogEvent[] = [
      { type: 'user', message: { content: 'fix the bug' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.' }] } },
    ];
    expect(stripNoise(events)).toHaveLength(2);
  });

  it('keeps Write tool_use calls', () => {
    const events: ClaudeLogEvent[] = [
      {
        type: 'tool_use',
        message: {
          content: [{ type: 'tool_use', name: 'Write', id: 't1', input: { file_path: 'a.ts' } }],
        },
      },
    ];
    expect(stripNoise(events)).toHaveLength(1);
  });

  it('removes Read tool_use calls', () => {
    const events: ClaudeLogEvent[] = [
      {
        type: 'tool_use',
        message: {
          content: [{ type: 'tool_use', name: 'Read', id: 't2', input: { file_path: 'b.ts' } }],
        },
      },
    ];
    expect(stripNoise(events)).toHaveLength(0);
  });

  it('removes Bash tool_use calls', () => {
    const events: ClaudeLogEvent[] = [
      {
        type: 'tool_use',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', id: 't3', input: { command: 'ls' } }],
        },
      },
    ];
    expect(stripNoise(events)).toHaveLength(0);
  });

  it('keeps Edit and MultiEdit tool_use calls', () => {
    const editEvents: ClaudeLogEvent[] = [
      { type: 'tool_use', message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e1', input: {} }] } },
      { type: 'tool_use', message: { content: [{ type: 'tool_use', name: 'MultiEdit', id: 'e2', input: {} }] } },
    ];
    expect(stripNoise(editEvents)).toHaveLength(2);
  });

  it('keeps summary events', () => {
    const events: ClaudeLogEvent[] = [
      { type: 'summary', message: { content: 'compact summary of session' } },
    ];
    expect(stripNoise(events)).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(stripNoise([])).toEqual([]);
  });
});
