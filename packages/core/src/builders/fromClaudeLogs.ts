import { promises as fs } from 'node:fs';
import type { Handoff, HandoffGoal, HandoffDecision, HandoffBlocker, HandoffFileChange, HandoffNextStep } from '../types.js';
import { extractTitle, extractText, stripSystemTags } from '../utils.js';
import { stripNoise, type ClaudeLogEvent, type ContentBlock } from '../compress/stripNoise.js';

export async function fromClaudeLogs(
  transcriptPath: string,
  options: {
    maxMessages?: number;
    includeThinking?: boolean;
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
    description: firstText.slice(0, 2000),
    status: 'in_progress',
    sourceMessageIndex: 0,
  };

  // Extract file changes from Write/Edit tool calls
  const filesChanged: HandoffFileChange[] = [];
  const seenPaths = new Set<string>();

  const toolUseEvents = limited.filter(e => e.type === 'tool_use');
  for (const event of toolUseEvents) {
    const blocks = event.message?.content as ContentBlock[] | undefined;
    const toolBlock = blocks?.find(b => b.type === 'tool_use');
    if (!toolBlock?.input) continue;
    const input = toolBlock.input as { file_path?: string; new_content?: string; path?: string };
    const filePath = input.file_path || input.path;
    if (filePath && !seenPaths.has(filePath)) {
      seenPaths.add(filePath);
      filesChanged.push({
        path: filePath,
        status: 'modified',
        summary: '',
        importance: 'medium',
        linesAdded: 0,
        linesRemoved: 0,
      });
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
  /\b(decided|choosing|chose|going with|we('ll| will) use)\b/i,
  /\b(not using|avoiding|rejected|instead of|rather than)\b/i,
  /\b(the reason|because|rationale|trade-?off)\b/i,
];

function extractDecisions(events: ClaudeLogEvent[]): HandoffDecision[] {
  const decisions: HandoffDecision[] = [];
  let id = 0;

  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const text = extractText(event.message?.content);
    const sentences = text.split(/[.!?]+/);

    for (const sentence of sentences) {
      if (DECISION_PATTERNS.some(p => p.test(sentence)) && sentence.trim().length > 30) {
        decisions.push({
          id: `decision_${++id}`,
          summary: sentence.trim().slice(0, 200),
          rationale: '',
          timestamp: event.timestamp || new Date().toISOString(),
          confidence: 0.7,
        });
      }
    }
  }

  return decisions.slice(0, 10);
}

function extractBlocker(lastUser: string, lastAssistant: string): string {
  const errorPatterns = [
    /error:/i, /failed/i, /cannot/i, /unable to/i, /❌/,
    /test.*fail/i, /compilation error/i, /type error/i,
  ];

  const combined = `${lastUser} ${lastAssistant}`;
  const hasError = errorPatterns.some(p => p.test(combined));

  if (hasError) {
    const shorter = lastAssistant.length > 0 ? lastAssistant : lastUser;
    return shorter.slice(0, 500).trim();
  }

  if (lastUser.length > 0) {
    return lastUser.slice(0, 300).trim();
  }

  return '';
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
