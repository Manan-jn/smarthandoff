export type Importance = 'critical' | 'high' | 'medium' | 'low';
export type TargetTool = 'claude' | 'gemini' | 'codex' | 'cursor' | 'chatgpt' | 'generic';
export type DeliveryMethod = 'pipe' | 'clipboard' | 'file-write' | 'two-part-clipboard';
export type HandoffMode = 'lean' | 'rich' | 'debug';

export interface HandoffGoal {
  id: string;
  title: string;
  description: string;
  status: 'in_progress' | 'completed' | 'blocked';
  sourceMessageIndex?: number;
}

export interface HandoffDecision {
  id: string;
  summary: string;
  rationale: string;
  alternatives?: string[];
  timestamp: string;
  confidence: number;
}

export interface HandoffFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  summary: string;
  diff?: string;
  importance: Importance;
  linesAdded: number;
  linesRemoved: number;
  testsImpacted?: string[];
}

export interface HandoffBlocker {
  id: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
  errorMessage?: string;
  errorLocation?: string;
  suggestedNextSteps?: string;
}

export interface HandoffNextStep {
  id: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  estimateMinutes?: number;
  specificAction?: string;
}

export interface HandoffProjectContext {
  stack: string[];
  testCommand?: string;
  buildCommand?: string;
  claudeMdContent?: string;
  agentsMdContent?: string;
  gitBranch?: string;
  packageJson?: {
    name: string;
    version: string;
    dependencies: Record<string, string>;
  };
}

export interface HandoffSessionSegment {
  summary: string;
  timestamp: string;
  gitBranch?: string;
  preTokens: number;
  postTokens: number;
}

export interface HandoffSource {
  tool: TargetTool | 'claude-code' | 'gemini-cli' | 'codex-cli' | 'cursor' | 'other';
  sessionId?: string;
  transcriptPath?: string;
  collectedAt: string;
}

export interface AdapterOutput {
  text: string;
  systemPrompt?: string;
  deliveryMethod: DeliveryMethod;
  targetTool: TargetTool;
  tokenCount: number;
  filesToWrite?: Array<{
    path: string;
    content: string;
    isTemporary: boolean;
  }>;
  filesToCleanup?: string[];
  launchCommand?: string;
}

export interface AdapterOptions {
  tokenBudget?: number;
  mode?: HandoffMode;
  includeFullDiffs?: boolean;
}

export interface Handoff {
  id: string;
  projectId?: string;
  projectRoot: string;
  createdAt: string;
  createdBy: string;
  mode: HandoffMode;
  goals: HandoffGoal[];
  decisions: HandoffDecision[];
  filesChanged: HandoffFileChange[];
  blockers: HandoffBlocker[];
  nextSteps: HandoffNextStep[];
  context: HandoffProjectContext;
  notes?: string;
  sources: HandoffSource[];
  extractionConfidence: number;
  rawTokenCount: number;
  cachedOutputs?: Partial<Record<TargetTool, AdapterOutput>>;
  metadata?: Record<string, unknown>;
  prLinks?: string[];
  sessionSegments?: HandoffSessionSegment[];
  goalProgression?: string[];
}
