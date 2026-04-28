import type { HandoffMode } from '../types.js';

export interface PolicyConfig {
  autoSnapshotOnRateLimit: boolean;
  autoSnapshotOnPreCompact: boolean;
  autoSnapshotOnSessionEnd: boolean;
  minFilesChanged: number;
  minMessages: number;
}

export interface SessionMetrics {
  messageCount: number;
  filesChanged: number;
  hasBlocker: boolean;
  trigger: 'rate_limit' | 'precompact' | 'session_end' | 'manual';
}

export type PolicyDecision = {
  action: 'none' | 'suggest' | 'auto';
  mode: HandoffMode;
  reason: string;
};

export function evaluatePolicy(
  config: PolicyConfig,
  metrics: SessionMetrics
): PolicyDecision {
  if (metrics.trigger === 'rate_limit' && config.autoSnapshotOnRateLimit) {
    return { action: 'auto', mode: 'lean', reason: 'Rate limit hit — lean handoff for immediate resumption' };
  }

  if (metrics.trigger === 'precompact' && config.autoSnapshotOnPreCompact) {
    if (metrics.filesChanged >= config.minFilesChanged || metrics.messageCount >= config.minMessages) {
      return {
        action: 'auto',
        mode: 'rich',
        reason: `Context filling — rich snapshot (${metrics.filesChanged} files, ${metrics.messageCount} messages)`,
      };
    }
    return { action: 'none', mode: 'lean', reason: 'Session too short for auto-snapshot' };
  }

  if (metrics.trigger === 'session_end' && config.autoSnapshotOnSessionEnd) {
    if (metrics.filesChanged >= config.minFilesChanged) {
      return { action: 'suggest', mode: 'rich', reason: `Session ended with ${metrics.filesChanged} changed files` };
    }
  }

  return { action: 'none', mode: 'lean', reason: 'No policy triggered' };
}
