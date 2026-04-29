import { execSync } from 'node:child_process';

const TOOL_COMMANDS: Record<string, string> = {
  gemini: 'gemini --version',
  codex:  'codex --version',
  claude: 'claude --version',
};

export async function detectTools(): Promise<string[]> {
  const available: string[] = [];

  for (const [tool, cmd] of Object.entries(TOOL_COMMANDS)) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      available.push(tool);
    } catch { /* not installed */ }
  }

  return available;
}

export async function autoDetectTarget(): Promise<string> {
  const available = await detectTools();
  const priority = ['gemini', 'codex', 'claude'];
  for (const tool of priority) {
    if (available.includes(tool)) return tool;
  }
  return 'generic';
}
