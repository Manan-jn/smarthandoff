import { promises as fs } from 'node:fs';
import path from 'node:path';

export type EventType =
  | 'HANDOFF_CREATED'
  | 'HANDOFF_USED'
  | 'ROUTE_TRIGGERED'
  | 'SNAPSHOT_TRIGGERED'
  | 'TOOL_DETECTED';

export interface HandoffEvent {
  type: EventType;
  timestamp: string;
  projectId?: string;
  handoffId?: string;
  targetTool?: string;
  trigger?: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export async function emitEvent(event: Omit<HandoffEvent, 'timestamp'>): Promise<void> {
  try {
    const full: HandoffEvent = { ...event, timestamp: new Date().toISOString() };
    const eventsPath = path.join(process.cwd(), '.smarthandoff', 'events.jsonl');
    await fs.appendFile(eventsPath, JSON.stringify(full) + '\n', 'utf8');
  } catch { /* analytics are best-effort */ }
}
