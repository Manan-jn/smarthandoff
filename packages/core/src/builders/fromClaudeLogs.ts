import { promises as fs } from 'node:fs';
import type { Handoff, HandoffGoal, HandoffDecision, HandoffBlocker, HandoffFileChange, HandoffNextStep } from '../types.js';
import { extractTitle, extractText, stripSystemTags } from '../utils.js';
import { stripNoise, type ClaudeLogEvent, type ContentBlock } from '../compress/stripNoise.js';

// Generated adapter output files that should not appear in filesChanged
const GENERATED_FILENAMES = new Set(['GEMINI.md', 'AGENTS.md', 'cursor-rules.mdc', 'chatgpt-system.md']);

function isInternalPath(filePath: string): boolean {
  if (filePath.includes('/.claude/')) return true;
  if (filePath.match(/\.?smarthandoff\//)) return true;
  if (GENERATED_FILENAMES.has(filePath.split('/').pop() ?? '')) return true;
  return false;
}

function relativizeAndFilter(filePath: string, projectRoot?: string): string | null {
  if (isInternalPath(filePath)) return null;
  if (projectRoot && filePath.startsWith(projectRoot + '/')) {
    return filePath.slice(projectRoot.length + 1);
  }
  return filePath;
}

function inferFileSummary(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Write' || toolName === 'NotebookEdit') {
    const content = (input.new_content as string) || (input.source as string) || '';
    const firstMeaningful = content.split('\n').find(
      l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#') && !l.trim().startsWith('/*') && !l.trim().startsWith('*')
    );
    return firstMeaningful?.trim().slice(0, 100) || '';
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    const newStr = (input.new_string as string) || '';
    const firstLine = newStr.split('\n').find(l => l.trim());
    return firstLine ? `edit: ${firstLine.trim().slice(0, 80)}` : 'edited';
  }
  return '';
}

function cleanSlice(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);

  // Cut before any code block that starts in the slice
  const codeBlockIdx = truncated.indexOf('```');
  if (codeBlockIdx > maxChars * 0.3) {
    const beforeCode = truncated.slice(0, codeBlockIdx);
    const paraBreak = beforeCode.lastIndexOf('\n\n');
    if (paraBreak > 0) return beforeCode.slice(0, paraBreak).trim();
    return beforeCode.trim();
  }

  // Prefer paragraph break
  const paraBreak = truncated.lastIndexOf('\n\n');
  if (paraBreak > maxChars * 0.5) return truncated.slice(0, paraBreak).trim();

  // Fall back to sentence end
  const lastPeriod = truncated.search(/[.!?][^.!?]*$/);
  if (lastPeriod > maxChars * 0.5) return truncated.slice(0, lastPeriod + 1).trim();

  return truncated.trim();
}

export async function fromClaudeLogs(
  transcriptPath: string,
  options: {
    maxMessages?: number;
    includeThinking?: boolean;
    projectRoot?: string;
  } = {}
): Promise<Partial<Handoff>> {
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch {
    return {};
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  const events: ClaudeLogEvent[] = lines
    .map(l => {
      try { return JSON.parse(l) as ClaudeLogEvent; } catch { return null; }
    })
    .filter((e): e is ClaudeLogEvent => e !== null);

  const signalEvents = stripNoise(events);
  const limited = options.maxMessages
    ? signalEvents.slice(-options.maxMessages)
    : signalEvents;

  // Extract goal from first user message
  const firstUserEvent = limited.find(e => e.type === 'user');
  const firstContent = firstUserEvent?.message?.content;
  const firstText = stripSystemTags(extractText(firstContent));

  const goal: HandoffGoal = {
    id: 'goal_1',
    title: extractTitle(firstText),
    description: cleanSlice(firstText, 2000),
    status: 'in_progress',
    sourceMessageIndex: 0,
  };

  // Extract file changes from Write/Edit tool calls embedded in assistant events
  const filesChanged: HandoffFileChange[] = [];
  const seenPaths = new Set<string>();
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

  for (const event of limited) {
    if (event.type !== 'assistant') continue;
    const blocks = event.message?.content as ContentBlock[] | undefined;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type !== 'tool_use' || !WRITE_TOOLS.has(block.name ?? '')) continue;
      const input = block.input as { file_path?: string; path?: string } | undefined;
      const filePath = input?.file_path || input?.path;
      if (filePath && !seenPaths.has(filePath)) {
        const rel = relativizeAndFilter(filePath, options.projectRoot);
        if (rel !== null) {
          seenPaths.add(filePath);
          filesChanged.push({
            path: rel,
            status: 'modified',
            summary: inferFileSummary(block.name ?? '', block.input as Record<string, unknown>),
            importance: 'medium',
            linesAdded: 0,
            linesRemoved: 0,
          });
        }
      }
    }
  }

  // Extract blocker from last messages
  const lastUserEvent = [...limited].reverse().find(e => e.type === 'user');
  const lastAssistantEvent = [...limited].reverse().find(e => e.type === 'assistant');

  const lastUserText = stripSystemTags(extractText(lastUserEvent?.message?.content));
  const lastAssistantText = extractText(lastAssistantEvent?.message?.content);

  const blockers: HandoffBlocker[] = [];
  const blockerDesc = extractBlocker(lastUserText, lastAssistantText);
  if (blockerDesc) {
    blockers.push({
      id: 'blocker_1',
      description: blockerDesc,
      severity: 'high',
      errorMessage: extractErrorMessage(lastAssistantText),
      errorLocation: extractErrorLocation(lastAssistantText),
      suggestedNextSteps: extractNextStep(lastAssistantText),
    });
  }

  // Extract decisions
  const decisions = extractDecisions(limited);

  // Extract next step
  const nextSteps: HandoffNextStep[] = [];
  const nextStepText = blockers[0]?.suggestedNextSteps || extractNextStep(lastAssistantText);
  if (nextStepText) {
    nextSteps.push({
      id: 'next_1',
      description: nextStepText,
      priority: 'high',
      specificAction: nextStepText,
    });
  }

  return {
    goals: firstText ? [goal] : [],
    filesChanged,
    blockers,
    decisions,
    nextSteps,
    sources: [{
      tool: 'claude-code',
      transcriptPath,
      collectedAt: new Date().toISOString(),
    }],
  };
}

const DECISION_PATTERNS = [
  /\b(decided|choosing|chose|going with|we('ll| will) use|I('ll| will) use)\b/i,
  /\b(not using|avoiding|rejected|instead of|rather than|dropped|removed)\b/i,
  /\b(the reason is|rationale|trade-?off|the fix is|root cause)\b/i,
];

// Sentences that are clearly not decisions — meta-commentary, fragments, questions
const DECISION_NOISE = [
  /^[),"'\s*]/,                         // starts with fragment punctuation or markdown bold **
  /^\*\*/,                              // markdown bold heading
  /\?$/,                                // questions
  /^(The|This|That|It|There|Here)\s+(is|are|was|were|will|would|can|could|should|has|have)\b/i,
  /\bthe handoff\b/i,                   // meta-commentary about the handoff tool itself
  /\bextract(or|ion|ing|ed)\b/i,        // talking about extraction logic
  /\btoken budget\b/i,                  // token budget explanations
  /\b(summary|files changed|next steps|decisions made)\b/i, // label headers
  /^[A-Z\s]+\*\*\s*—/,                 // "HEADING** —" pattern (markdown section headers)
];

function extractDecisions(events: ClaudeLogEvent[]): HandoffDecision[] {
  const decisions: HandoffDecision[] = [];
  const seen = new Set<string>();
  let id = 0;

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const text = extractText(event.message?.content);
    const sentences = text.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (s.length < 50 || s.length > 300) continue;
      if (!DECISION_PATTERNS.some(p => p.test(s))) continue;
      if (DECISION_NOISE.some(p => p.test(s))) continue;
      // Require sentence starts with capital letter (complete sentence, not fragment)
      if (!/^[A-Z"']/.test(s)) continue;

      const key = s.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      decisions.push({
        id: `decision_${++id}`,
        summary: s.slice(0, 200),
        rationale: '',
        timestamp: event.timestamp || new Date().toISOString(),
        confidence: 0.7,
      });
    }
  }

  return decisions.slice(0, 10);
}

function extractBlocker(lastUser: string, lastAssistant: string): string {
  const errorPatterns = [
    /error:/i, /failed/i, /cannot/i, /unable to/i, /❌/,
    /test.*fail/i, /compilation error/i, /type error/i,
    /\bstuck\b/i, /\bblocked\b/i, /\bbreaking\b/i, /exception:/i,
  ];

  const combined = `${lastUser} ${lastAssistant}`;
  const hasError = errorPatterns.some(p => p.test(combined));

  if (!hasError) return '';

  // Prefer assistant text (has the error detail), fall back to user
  const source = lastAssistant.length > 50 ? lastAssistant : lastUser;
  return source.slice(0, 500).trim();
}

function extractErrorMessage(text: string): string | undefined {
  const errorMatch = text.match(/(?:Error|error|ERROR):\s*([^\n]+)/);
  return errorMatch?.[1]?.trim().slice(0, 200);
}

function extractErrorLocation(text: string): string | undefined {
  const locMatch = text.match(/([a-zA-Z0-9_./\\-]+\.[a-zA-Z]+):(\d+)/);
  if (locMatch) return `${locMatch[1]}:${locMatch[2]}`;
  return undefined;
}

function extractNextStep(text: string): string | undefined {
  const nextPatterns = [
    /next[,\s]+(?:we(?:'ll| will|'d)|you(?:'ll| will|'d)|I(?:'ll| will|'d))?\s+(?:need to |should |can |)(.{20,200})/i,
    /(?:the next step|to fix this|to resolve)\s+(?:is\s+)?(.{20,200})/i,
  ];

  for (const pattern of nextPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().slice(0, 200);
  }

  return undefined;
}
