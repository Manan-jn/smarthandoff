import type { Handoff, AdapterOutput, AdapterOptions, TargetTool } from '../types.js';
import { toClaude } from './claude.js';
import { toGeneric } from './generic.js';

export { toClaude } from './claude.js';
export { toGeneric } from './generic.js';

export function toAdapter(
  handoff: Handoff,
  target: TargetTool,
  options: AdapterOptions = {}
): AdapterOutput {
  switch (target) {
    case 'claude': return toClaude(handoff, options);
    case 'generic': return toGeneric(handoff, options);
    // Other adapters added in Milestone 2
    default: return toGeneric(handoff, options);
  }
}
