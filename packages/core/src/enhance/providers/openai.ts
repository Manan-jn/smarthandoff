import type { LLMProvider } from './index.js';

export class OpenAIProvider implements LLMProvider {
  private model: string;
  private apiKey: string;

  constructor(options: { model: string; apiKey: string }) {
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async call(prompt: string, schema: object): Promise<unknown> {
    let OpenAI: typeof import('openai').default;
    try {
      const mod = await import('openai');
      OpenAI = mod.default;
    } catch {
      throw new Error('OpenAI SDK not installed. Run: npm install openai');
    }

    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are a JSON API. Return only a valid JSON object matching the schema. No prose, no markdown, no explanation.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'handoff_enhancement',
          schema,
          strict: false,
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');

    try {
      return JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? content.match(/(\{[\s\S]*\})/);
      if (match?.[1]) return JSON.parse(match[1].trim());
      throw new Error(`OpenAI returned non-JSON response: ${content.slice(0, 200)}`);
    }
  }
}
