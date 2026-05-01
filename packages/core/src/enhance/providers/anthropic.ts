import type { LLMProvider } from './index.js';

export class AnthropicProvider implements LLMProvider {
  private model: string;
  private apiKey: string;

  constructor(options: { model: string; apiKey: string }) {
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async call(prompt: string, schema: object): Promise<unknown> {
    let Anthropic: typeof import('@anthropic-ai/sdk').default;
    try {
      const mod = await import('@anthropic-ai/sdk');
      Anthropic = mod.default;
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }

    const client = new Anthropic({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [{
        name: 'return_handoff',
        description: 'Return the enhanced handoff fields as structured JSON',
        input_schema: schema as Parameters<typeof client.messages.create>[0]['tools'][0]['input_schema'],
      }],
      tool_choice: { type: 'tool', name: 'return_handoff' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find(b => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('Anthropic response did not contain a tool_use block');
    }
    return toolUse.input;
  }
}
