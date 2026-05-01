import type { Handoff, HandoffDecision, HandoffBlocker, HandoffNextStep } from '../types.js';
import { buildPrompt, ENHANCE_SCHEMA } from './prompt.js';
import { createProvider, autoDetectProvider, type ProviderName } from './providers/index.js';

export interface SummarizeOptions {
  provider?: ProviderName;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface EnhancedGoal {
  title: string;
  description: string;
}

interface EnhancedDecision {
  summary: string;
  rationale: string;
}

interface EnhancedBlocker {
  description: string;
  errorMessage?: string;
  errorLocation?: string;
  suggestedNextSteps: string;
}

interface EnhancedFile {
  path: string;
  summary: string;
}

interface EnhancedNextStep {
  description: string;
  specificAction: string;
  priority: 'high' | 'medium' | 'low';
}

interface EnhancedHandoff {
  goal: EnhancedGoal;
  decisions: EnhancedDecision[];
  blockers: EnhancedBlocker[];
  filesChanged: EnhancedFile[];
  nextSteps: EnhancedNextStep[];
}

export async function summarize(handoff: Handoff, options: SummarizeOptions = {}): Promise<Handoff> {
  const transcriptPath = handoff.sources.find(s => s.transcriptPath)?.transcriptPath;
  if (!transcriptPath) {
    process.stderr.write('⚠ Summarization skipped: no transcript path in handoff sources\n');
    return handoff;
  }

  const providerName = options.provider ?? autoDetectProvider();

  try {
    const llm = await createProvider(providerName, {
      model: options.model,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
    });
    const prompt = await buildPrompt(handoff, transcriptPath);
    const enhanced = await llm.call(prompt, ENHANCE_SCHEMA) as EnhancedHandoff;

    return mergeEnhancements(handoff, enhanced);
  } catch (err) {
    process.stderr.write(`⚠ Summarization skipped: ${(err as Error).message}\n`);
    return handoff;
  }
}

function mergeEnhancements(handoff: Handoff, enhanced: EnhancedHandoff): Handoff {
  const fileSummaryMap = new Map<string, string>();
  for (const f of enhanced.filesChanged) {
    if (f.path && f.summary) fileSummaryMap.set(f.path, f.summary);
  }

  return {
    ...handoff,

    goals: handoff.goals.length > 0 ? [{
      ...handoff.goals[0],
      title: enhanced.goal.title || handoff.goals[0].title,
      description: enhanced.goal.description || handoff.goals[0].description,
    }] : handoff.goals,

    decisions: enhanced.decisions.map((d, i): HandoffDecision => ({
      id: handoff.decisions[i]?.id ?? `decision_llm_${i + 1}`,
      summary: d.summary,
      rationale: d.rationale,
      timestamp: handoff.decisions[i]?.timestamp ?? new Date().toISOString(),
      confidence: 0.9,
    })),

    blockers: enhanced.blockers.map((b, i): HandoffBlocker => ({
      id: handoff.blockers[i]?.id ?? `blocker_llm_${i + 1}`,
      description: b.description,
      severity: handoff.blockers[i]?.severity ?? 'high',
      errorMessage: b.errorMessage || handoff.blockers[i]?.errorMessage,
      errorLocation: b.errorLocation || handoff.blockers[i]?.errorLocation,
      suggestedNextSteps: b.suggestedNextSteps,
    })),

    filesChanged: handoff.filesChanged.map(f => ({
      ...f,
      summary: fileSummaryMap.get(f.path) || f.summary,
    })),

    nextSteps: enhanced.nextSteps.map((n, i): HandoffNextStep => ({
      id: handoff.nextSteps[i]?.id ?? `next_llm_${i + 1}`,
      description: n.description,
      priority: n.priority,
      specificAction: n.specificAction || n.description,
    })),
  };
}
