import { promises as fs } from 'node:fs';
import type { Handoff, HandoffGoal, HandoffDecision, HandoffBlocker, HandoffFileChange, HandoffNextStep, HandoffSessionSegment } from '../types.js';
import { extractTitle, extractText, stripSystemTags } from '../utils.js';
import { stripNoise, type ClaudeLogEvent, type ContentBlock } from '../compress/stripNoise.js';
import {
  findCompactBoundaries,
  extractCompactSummary,
  extractLastPrompts,
  extractPrLinks,
  extractTodoPendingTasks,
  getCurrentBranch,
} from './sessionUtils.js';

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
  if (projectRoot) {
    if (filePath.startsWith(projectRoot + '/')) {
      return filePath.slice(projectRoot.length + 1);
    }
    // path is outside projectRoot — skip it
    return null;
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

  const codeBlockIdx = truncated.indexOf('```');
  if (codeBlockIdx > maxChars * 0.3) {
    const beforeCode = truncated.slice(0, codeBlockIdx);
    const paraBreak = beforeCode.lastIndexOf('\n\n');
    if (paraBreak > 0) return beforeCode.slice(0, paraBreak).trim();
    return beforeCode.trim();
  }

  const paraBreak = truncated.lastIndexOf('\n\n');
  if (paraBreak > maxChars * 0.5) return truncated.slice(0, paraBreak).trim();

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
  const allEvents: ClaudeLogEvent[] = lines
    .map(l => {
      try { return JSON.parse(l) as ClaudeLogEvent; } catch { return null; }
    })
    .filter((e): e is ClaudeLogEvent => e !== null);

  // Session segmentation: find compact boundaries and split
  const boundaries = findCompactBoundaries(allEvents);
  const lastBoundaryIdx = boundaries.length > 0 ? boundaries[boundaries.length - 1]! : -1;
  const currentSegmentEvents = lastBoundaryIdx >= 0
    ? allEvents.slice(lastBoundaryIdx + 1)
    : allEvents;

  // Build session history from compact summaries (Scenario B: post-compaction)
  const sessionSegments: HandoffSessionSegment[] = boundaries
    .map(bi => {
      const boundary = allEvents[bi]!;
      return {
        summary: extractCompactSummary(allEvents, bi),
        timestamp: boundary.timestamp ?? new Date().toISOString(),
        gitBranch: boundary.gitBranch,
        preTokens: boundary.preTokens ?? 0,
        postTokens: boundary.postTokens ?? 0,
      };
    })
    .filter(s => s.summary.length > 0);

  // Signal events: only from current segment (post-last-compact)
  const signalEvents = stripNoise(currentSegmentEvents);
  const limited = options.maxMessages
    ? signalEvents.slice(-options.maxMessages)
    : signalEvents;

  // Goal: prefer last-prompt event (verbatim user intent, no IDE noise injected)
  // Fallback: first user message in current segment
  const lastPrompts = extractLastPrompts(allEvents);
  const goalText = lastPrompts.length > 0
    ? lastPrompts[lastPrompts.length - 1]!
    : stripSystemTags(extractText(signalEvents.find(e => e.type === 'user')?.message?.content));

  // Goal progression: how the session's intent evolved (Scenario A: multiple last-prompts)
  const goalProgression = lastPrompts.length > 1 ? lastPrompts : [];

  const goal: HandoffGoal = {
    id: 'goal_1',
    title: extractTitle(goalText),
    description: cleanSlice(goalText, 2000),
    status: 'in_progress',
    sourceMessageIndex: 0,
  };

  // PR links
  const prLinks = extractPrLinks(allEvents);

  // File changes: last-edit-wins (Map keyed by absolute path, overwrite on repeat)
  const fileMap = new Map<string, HandoffFileChange>();
  const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

  for (const event of limited) {
    if (event.type !== 'assistant') continue;
    const blocks = event.message?.content as ContentBlock[] | undefined;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block.type !== 'tool_use' || !WRITE_TOOLS.has(block.name ?? '')) continue;
      const input = block.input as { file_path?: string; path?: string } | undefined;
      const filePath = input?.file_path || input?.path;
      if (filePath) {
        const rel = relativizeAndFilter(filePath, options.projectRoot);
        if (rel !== null) {
          fileMap.set(filePath, {
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
  const filesChanged = [...fileMap.values()];

  // Next steps: prefer todo_reminder pending tasks over heuristic extraction
  const todoTasks = extractTodoPendingTasks(allEvents);
  let nextSteps: HandoffNextStep[] = todoTasks.map((task, i) => ({
    id: `next_${i + 1}`,
    description: task,
    priority: i === 0 ? ('high' as const) : ('medium' as const),
    specificAction: task,
  }));

  // Blocker extraction from last messages in current segment
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

  // Fall back to heuristic next step only when no todo tasks
  if (nextSteps.length === 0) {
    const nextStepText = blockers[0]?.suggestedNextSteps || extractNextStep(lastAssistantText);
    if (nextStepText) {
      nextSteps.push({
        id: 'next_1',
        description: nextStepText,
        priority: 'high',
        specificAction: nextStepText,
      });
    }
  }

  const decisions = extractDecisions(limited);
  const gitBranch = getCurrentBranch(allEvents);

  return {
    goals: goalText ? [goal] : [],
    filesChanged,
    blockers,
    decisions,
    nextSteps,
    ...(prLinks.length > 0 ? { prLinks } : {}),
    ...(sessionSegments.length > 0 ? { sessionSegments } : {}),
    ...(goalProgression.length > 0 ? { goalProgression } : {}),
    ...(gitBranch ? { context: { stack: [], gitBranch } } : {}),
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

const DECISION_NOISE = [
  /^[),"'\s*]/,
  /^\*\*/,
  /\?$/,
  /^(The|This|That|It|There|Here)\s+(is|are|was|were|will|would|can|could|should|has|have)\b/i,
  /^I('ll| will)\b/i,
  /^(Now|Let|First|Then|Next|Also|Note)\b/i,
  /^(Paste|Run|Add|Check|Look|See)\b/i,
  /\bthe handoff\b/i,
  /\bextract(or|ion|ing|ed)\b/i,
  /\btoken budget\b/i,
  /\b(summary|files changed|next steps|decisions made)\b/i,
  /^[A-Z\s]+\*\*\s*—/,
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
  if (!errorPatterns.some(p => p.test(combined))) return '';

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
