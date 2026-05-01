import type { Handoff, HandoffFileChange, HandoffSource } from '../types.js';
import { estimateTokens } from '../utils.js';

interface MergeMetadata {
  projectRoot: string;
  sessionId?: string;
  createdBy: string;
  mode?: Handoff['mode'];
}

export function merge(
  partials: Partial<Handoff>[],
  metadata: MergeMetadata
): Handoff {
  const acc = createEmptyHandoff(metadata);

  for (const partial of partials) {
    if (partial.goals) acc.goals.push(...partial.goals);
    if (partial.decisions) acc.decisions.push(...partial.decisions);
    if (partial.blockers) acc.blockers.push(...partial.blockers);
    if (partial.nextSteps) acc.nextSteps.push(...partial.nextSteps);

    if (partial.filesChanged) {
      for (const file of partial.filesChanged) {
        const existingIdx = acc.filesChanged.findIndex(f => f.path === file.path);
        if (existingIdx >= 0) {
          acc.filesChanged[existingIdx] = mergeFileChange(acc.filesChanged[existingIdx]!, file);
        } else {
          acc.filesChanged.push(file);
        }
      }
    }

    if (partial.context) {
      acc.context = {
        ...acc.context,
        ...partial.context,
        stack: [...(acc.context.stack || []), ...(partial.context.stack || [])],
      };
    }

    if (partial.notes) {
      acc.notes = [acc.notes, partial.notes].filter(Boolean).join('\n\n');
    }

    if (partial.sources) {
      acc.sources.push(...partial.sources);
    }
  }

  // Deduplicate sources by tool
  acc.sources = deduplicateSources(acc.sources);

  // Deduplicate stack
  acc.context.stack = [...new Set(acc.context.stack)];

  // Generate stable ID
  const sessionPrefix = metadata.sessionId?.slice(0, 8) || 'manual';
  acc.id = `shoff_${Date.now()}_${sessionPrefix}`;

  // Calculate derived fields
  acc.rawTokenCount = estimateTokens(JSON.stringify(acc));
  acc.extractionConfidence = calculateConfidence(acc);

  return acc;
}

function createEmptyHandoff(metadata: MergeMetadata): Handoff {
  return {
    id: '',
    projectRoot: metadata.projectRoot,
    createdAt: new Date().toISOString(),
    createdBy: metadata.createdBy,
    mode: metadata.mode || 'rich',
    goals: [],
    decisions: [],
    filesChanged: [],
    blockers: [],
    nextSteps: [],
    context: { stack: [] },
    sources: [],
    extractionConfidence: 0,
    rawTokenCount: 0,
  };
}

function deduplicateSources(sources: HandoffSource[]): HandoffSource[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const key = `${s.tool}:${s.sessionId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeFileChange(existing: HandoffFileChange, incoming: HandoffFileChange): HandoffFileChange {
  return {
    ...existing,
    ...incoming,
    // Prefer non-empty summary
    summary: incoming.summary || existing.summary,
    // Prefer non-zero line counts
    linesAdded: incoming.linesAdded || existing.linesAdded,
    linesRemoved: incoming.linesRemoved || existing.linesRemoved,
    // Prefer non-empty diff
    diff: incoming.diff || existing.diff,
    // Merge testsImpacted arrays
    testsImpacted: [
      ...new Set([...(existing.testsImpacted ?? []), ...(incoming.testsImpacted ?? [])]),
    ],
  };
}

function calculateConfidence(handoff: Handoff): number {
  let score = 0;
  let factors = 0;

  if (handoff.goals.length > 0) { score += 0.9; factors++; }
  if (handoff.filesChanged.length > 0) { score += 0.8; factors++; }
  if (handoff.blockers.length > 0) { score += 0.7; factors++; }
  if (handoff.decisions.length > 0) { score += 0.7; factors++; }
  if (handoff.context.stack.length > 0) { score += 0.5; factors++; }

  return factors > 0 ? score / factors : 0.5;
}
