import type { Handoff, AdapterOutput, AdapterOptions, TargetTool } from '../types.js';
import { toClaude } from './claude.js';
import { toGeneric } from './generic.js';
import { toGemini } from './gemini.js';
import { toCodex } from './codex.js';
import { toCursor } from './cursor.js';
import { toChatGPT } from './chatgpt.js';

export { toClaude } from './claude.js';
export { toGeneric } from './generic.js';
export { toGemini } from './gemini.js';
export { toCodex } from './codex.js';
export { toCursor } from './cursor.js';
export { toChatGPT } from './chatgpt.js';

export function toAdapter(
  handoff: Handoff,
  target: TargetTool,
  options: AdapterOptions = {}
): AdapterOutput {
  switch (target) {
    case 'claude':   return toClaude(handoff, options);
    case 'gemini':   return toGemini(handoff, options);
    case 'codex':    return toCodex(handoff, options);
    case 'cursor':   return toCursor(handoff, options);
    case 'chatgpt':  return toChatGPT(handoff, options);
    case 'generic':  return toGeneric(handoff, options);
    default:         return toGeneric(handoff, options);
  }
}
