import { execSync } from 'node:child_process';

export type ProviderName = 'claude-cli' | 'anthropic' | 'gemini' | 'openai';

export interface ProviderOptions {
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface LLMProvider {
  call(prompt: string, schema: object): Promise<unknown>;
}

export const PROVIDER_DEFAULTS: Record<ProviderName, string> = {
  'claude-cli': 'sonnet',
  'anthropic': 'claude-sonnet-4-6',
  'gemini': 'gemini-2.5-flash',
  'openai': 'gpt-4o-mini',
};

export const PROVIDER_ENV_KEYS: Partial<Record<ProviderName, string[]>> = {
  'anthropic': ['ANTHROPIC_API_KEY'],
  'gemini': ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'openai': ['OPENAI_API_KEY'],
};

export const PROVIDER_SDK_INSTALL: Partial<Record<ProviderName, string>> = {
  'anthropic': 'npm install @anthropic-ai/sdk',
  'gemini': 'npm install @google/generative-ai',
  'openai': 'npm install openai',
};

export function autoDetectProvider(): ProviderName {
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic';
  if (process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY']) return 'gemini';
  if (process.env['OPENAI_API_KEY']) return 'openai';

  try {
    execSync('which claude', { stdio: 'ignore' });
    return 'claude-cli';
  } catch { /* not in PATH */ }

  throw new Error(
    'No summarization provider found.\n' +
    'Options:\n' +
    '  Set ANTHROPIC_API_KEY   → uses Anthropic SDK (claude-sonnet-4-6)\n' +
    '  Set GEMINI_API_KEY      → uses Gemini (gemini-2.5-flash)\n' +
    '  Set OPENAI_API_KEY      → uses OpenAI (gpt-4o-mini)\n' +
    '  Install claude CLI      → uses claude --print (no API key needed)'
  );
}

export function resolveApiKey(provider: ProviderName, explicit?: string): string {
  if (explicit) return explicit;
  const envKeys = PROVIDER_ENV_KEYS[provider] ?? [];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) return val;
  }
  throw new Error(
    `No API key for provider "${provider}".\n` +
    `Set ${envKeys.join(' or ')} environment variable.`
  );
}

export async function createProvider(name: ProviderName, options: ProviderOptions): Promise<LLMProvider> {
  const model = options.model ?? PROVIDER_DEFAULTS[name];

  switch (name) {
    case 'claude-cli': {
      const { ClaudeCliProvider } = await import('./claudeCliProvider.js');
      return new ClaudeCliProvider({ model, timeoutMs: options.timeoutMs });
    }
    case 'anthropic': {
      const apiKey = resolveApiKey('anthropic', options.apiKey);
      const { AnthropicProvider } = await import('./anthropic.js').catch(() => {
        throw new Error(`Anthropic SDK not installed. Run: ${PROVIDER_SDK_INSTALL['anthropic']}`);
      });
      return new AnthropicProvider({ model, apiKey });
    }
    case 'gemini': {
      const apiKey = resolveApiKey('gemini', options.apiKey);
      const { GeminiProvider } = await import('./gemini.js').catch(() => {
        throw new Error(`Gemini SDK not installed. Run: ${PROVIDER_SDK_INSTALL['gemini']}`);
      });
      return new GeminiProvider({ model, apiKey });
    }
    case 'openai': {
      const apiKey = resolveApiKey('openai', options.apiKey);
      const { OpenAIProvider } = await import('./openai.js').catch(() => {
        throw new Error(`OpenAI SDK not installed. Run: ${PROVIDER_SDK_INSTALL['openai']}`);
      });
      return new OpenAIProvider({ model, apiKey });
    }
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
}
