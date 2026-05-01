import type { LLMProvider } from './index.js';
import { callClaudeCli } from './claudeCli.js';

export class ClaudeCliProvider implements LLMProvider {
  private model: string;
  private timeoutMs?: number;

  constructor(options: { model: string; timeoutMs?: number }) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  async call(prompt: string, schema: object): Promise<unknown> {
    return callClaudeCli(prompt, schema, { model: this.model, timeoutMs: this.timeoutMs });
  }
}
