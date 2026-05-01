export interface ClaudeLogEvent {
  type:
    | 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'summary'
    | 'system' | 'last-prompt' | 'pr-link' | 'attachment'
    | 'ai-title' | 'file-history-snapshot' | 'queue-operation';
  message?: {
    role?: string;
    content: string | ContentBlock[];
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
  isSidechain?: number;
  gitBranch?: string;
  cwd?: string;
  sessionId?: string;
  // last-prompt event fields
  lastPrompt?: string;
  leafUuid?: string;
  // pr-link event fields
  url?: string;
  // system/compact_boundary fields
  preTokens?: number;
  postTokens?: number;
  // attachment event fields
  attachmentType?: string;
  content?: unknown;
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
    if (event.isSidechain) return false;
    if (event.type === 'tool_result') return false;
    if (event.type === 'summary') return true;
    if (event.type === 'user') return true;

    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (typeof content === 'string') return true;
      if (Array.isArray(content)) {
        // Keep if has text content OR has a Write/Edit tool call
        const hasText = content.some(b => b.type === 'text' && b.text?.trim());
        const hasWrite = content.some(b => b.type === 'tool_use' && WRITE_TOOLS.has(b.name ?? ''));
        return hasText || hasWrite;
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
