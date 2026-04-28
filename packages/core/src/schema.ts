import { z } from 'zod';

export const ImportanceSchema = z.enum(['critical', 'high', 'medium', 'low']);
export const TargetToolSchema = z.enum(['claude', 'gemini', 'codex', 'cursor', 'chatgpt', 'generic']);
export const DeliveryMethodSchema = z.enum(['pipe', 'clipboard', 'file-write', 'two-part-clipboard']);
export const HandoffModeSchema = z.enum(['lean', 'rich', 'debug']);

export const HandoffGoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['in_progress', 'completed', 'blocked']),
  sourceMessageIndex: z.number().optional(),
});

export const HandoffDecisionSchema = z.object({
  id: z.string(),
  summary: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()).optional(),
  timestamp: z.string(),
  confidence: z.number().min(0).max(1),
});

export const HandoffFileChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  summary: z.string(),
  diff: z.string().optional(),
  importance: ImportanceSchema,
  linesAdded: z.number(),
  linesRemoved: z.number(),
  testsImpacted: z.array(z.string()).optional(),
});

export const HandoffBlockerSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  errorMessage: z.string().optional(),
  errorLocation: z.string().optional(),
  suggestedNextSteps: z.string().optional(),
});

export const HandoffNextStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  estimateMinutes: z.number().optional(),
  specificAction: z.string().optional(),
});

export const HandoffProjectContextSchema = z.object({
  stack: z.array(z.string()),
  testCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  claudeMdContent: z.string().optional(),
  agentsMdContent: z.string().optional(),
  packageJson: z.object({
    name: z.string(),
    version: z.string(),
    dependencies: z.record(z.string()),
  }).optional(),
});

export const HandoffSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  projectRoot: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  mode: HandoffModeSchema,
  goals: z.array(HandoffGoalSchema),
  decisions: z.array(HandoffDecisionSchema),
  filesChanged: z.array(HandoffFileChangeSchema),
  blockers: z.array(HandoffBlockerSchema),
  nextSteps: z.array(HandoffNextStepSchema),
  context: HandoffProjectContextSchema,
  notes: z.string().optional(),
  sources: z.array(z.object({
    tool: z.string(),
    sessionId: z.string().optional(),
    transcriptPath: z.string().optional(),
    collectedAt: z.string(),
  })),
  extractionConfidence: z.number().min(0).max(1),
  rawTokenCount: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export function validateHandoff(data: unknown) {
  return HandoffSchema.safeParse(data);
}
