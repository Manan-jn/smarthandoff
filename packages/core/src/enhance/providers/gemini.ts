import type { LLMProvider } from './index.js';

export class GeminiProvider implements LLMProvider {
  private model: string;
  private apiKey: string;

  constructor(options: { model: string; apiKey: string }) {
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async call(prompt: string, schema: object): Promise<unknown> {
    let GoogleGenerativeAI: typeof import('@google/generative-ai').GoogleGenerativeAI;
    try {
      const mod = await import('@google/generative-ai');
      GoogleGenerativeAI = mod.GoogleGenerativeAI;
    } catch {
      throw new Error('Gemini SDK not installed. Run: npm install @google/generative-ai');
    }

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema as import('@google/generative-ai').Schema,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
      return JSON.parse(text);
    } catch {
      // Try extracting JSON from markdown code block
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
      if (match?.[1]) return JSON.parse(match[1].trim());
      throw new Error(`Gemini returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }
}
