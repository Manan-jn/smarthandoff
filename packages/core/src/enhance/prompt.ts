import { promises as fs } from 'node:fs';
import type { Handoff } from '../types.js';
import { stripNoise, type ClaudeLogEvent, type ContentBlock } from '../compress/stripNoise.js';
import { extractText, stripSystemTags } from '../utils.js';

export const ENHANCE_SCHEMA = {
  type: 'object',
  properties: {
    goal: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'description'],
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['summary', 'rationale'],
      },
    },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          errorMessage: { type: 'string' },
          errorLocation: { type: 'string' },
          suggestedNextSteps: { type: 'string' },
        },
        required: ['description', 'suggestedNextSteps'],
      },
    },
    filesChanged: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['path', 'summary'],
      },
    },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          specificAction: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['description', 'specificAction', 'priority'],
      },
    },
  },
  required: ['goal', 'decisions', 'blockers', 'filesChanged', 'nextSteps'],
} as const;

export async function buildPrompt(handoff: Handoff, transcriptPath: string): Promise<string> {
  const conversation = await reconstructConversation(transcriptPath);

  const extractedSummary = {
    goal: handoff.goals[0] ? {
      title: handoff.goals[0].title,
      description: handoff.goals[0].description,
    } : null,
    filesChanged: handoff.filesChanged.map(f => ({ path: f.path, status: f.status })),
    blockers: handoff.blockers.map(b => ({ description: b.description, errorMessage: b.errorMessage, errorLocation: b.errorLocation })),
    decisions: handoff.decisions.map(d => d.summary),
    nextSteps: handoff.nextSteps.map(n => n.description),
  };

  return `You are generating a handoff briefing so another AI coding assistant can resume this session without any context loss.

Read the full conversation carefully. Then improve the mechanically-extracted handoff data.

<conversation>
${conversation}
</conversation>

<extracted_handoff>
${JSON.stringify(extractedSummary, null, 2)}
</extracted_handoff>

Return a JSON object. Rules:

goal.title — Under 80 chars. What was actually being built, not the first words the user typed. Think: what would you name a PR for this work?

goal.description — 3–5 sentences covering: what was being built, the approach taken, where it stands now. Include the "why" if it came up in the conversation.

decisions — Real choices made during the session. Include implicit ones (e.g. "tried X but switched to Y because of Z"). Include technical trade-offs the engineer reasoned through. Remove meta-commentary and anything uncertain. Maximum 8. Each needs a summary (the decision) and rationale (why).

blockers — The actual unresolved problem if the session ended mid-task. Use the exact error message and location if present in the conversation. Empty array if the session ended cleanly or the task was completed.

filesChanged — Use ONLY the exact paths from extracted_handoff.filesChanged (do not invent paths). For each file, write a real human-readable summary: what changed in this file, and why. One sentence minimum.

nextSteps — What the next engineer (or AI) should do first, in order. Be specific: name the file, function, or command. Priority: high = do this first, medium = after that, low = eventually.

Respond with ONLY the JSON object. No preamble, no explanation, no markdown fences.`;
}

async function reconstructConversation(transcriptPath: string): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch {
    return '';
  }

  const lines = raw.trim().split('\n').filter(Boolean);
  const events: ClaudeLogEvent[] = lines
    .map(l => { try { return JSON.parse(l) as ClaudeLogEvent; } catch { return null; } })
    .filter((e): e is ClaudeLogEvent => e !== null);

  const signal = stripNoise(events);
  const turns: string[] = [];

  for (const event of signal) {
    if (event.type === 'user') {
      const text = stripSystemTags(extractText(event.message?.content));
      if (text.trim()) turns.push(`User:\n${text.trim()}`);
    } else if (event.type === 'assistant') {
      const content = event.message?.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = (content as ContentBlock[])
          .filter(b => b.type === 'text' && b.text?.trim())
          .map(b => b.text || '')
          .join('\n');
      }
      if (text.trim()) turns.push(`Assistant:\n${text.trim()}`);
    }
  }

  return turns.join('\n\n---\n\n');
}
