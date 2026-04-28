import type { Handoff } from '../types.js';

export interface ClaudeLogEvent {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'summary';
  message?: {
    role?: string;
    content: string | ContentBlock[];
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SKIP_TOOLS = new Set(['Read', 'Bash', 'LS', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoRead', 'TodoWrite']);

export function stripNoise(events: ClaudeLogEvent[]): ClaudeLogEvent[] {
  return events.filter(event => {
    if (event.type === 'tool_result') return false;
    if (event.type === 'summary') return true;
    if (event.type === 'user') return true;

    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (typeof content === 'string') return true;
      if (Array.isArray(content)) {
        return content.some(b => b.type === 'text' && b.text?.trim());
      }
      return false;
    }

    if (event.type === 'tool_use') {
      const blocks = event.message?.content as ContentBlock[] | undefined;
      const toolName = blocks?.find(b => b.type === 'tool_use')?.name;
      if (!toolName) return false;
      if (WRITE_TOOLS.has(toolName)) return true;
      if (SKIP_TOOLS.has(toolName)) return false;
      return false;
    }

    return false;
  });
}
