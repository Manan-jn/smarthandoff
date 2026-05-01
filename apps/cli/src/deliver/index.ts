import { promises as fs } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import type { AdapterOutput } from '@smarthandoff/core';

export async function deliver(
  output: AdapterOutput,
  opts: { forceClipboard?: boolean; forcePrint?: boolean; suppressOutput?: boolean; cwd?: string } = {}
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();

  // Always save to .smarthandoff/latest.md
  try {
    await fs.mkdir(path.join(cwd, '.smarthandoff'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.smarthandoff', 'latest.md'), output.text, 'utf8');
  } catch { /* ignore */ }

  // Write any requested files
  if (output.filesToWrite) {
    for (const f of output.filesToWrite) {
      const filePath = path.resolve(cwd, f.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, f.content, 'utf8');
    }
  }

  // suppressOutput: file is written but no stdout/clipboard delivery.
  // Used when --launch will handle delivery directly via the target CLI.
  if (opts.suppressOutput) return;

  if (opts.forcePrint) {
    process.stdout.write(output.text);
    return;
  }

  switch (output.deliveryMethod) {
    case 'pipe':
      process.stdout.write(output.text);
      break;

    case 'clipboard':
    case 'file-write':
      await copyToClipboard(output.text);
      console.error(`✓ Briefing copied to clipboard (${output.tokenCount.toLocaleString()} tokens)`);
      break;

    case 'two-part-clipboard':
      await copyToClipboard(output.text);
      console.error('\n📋 TWO-PART CLIPBOARD — ChatGPT needs two pastes:');
      console.error('\n1. SYSTEM PROMPT (paste in the system field):');
      console.error('─'.repeat(50));
      console.error(output.systemPrompt ?? '');
      console.error('─'.repeat(50));
      console.error('\n2. FIRST MESSAGE: Already copied to clipboard. Paste with Cmd+V.');
      break;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  const { default: clipboardy } = await import('clipboardy');
  await clipboardy.write(text);
}

// Binary name for PATH detection
const LAUNCH_BINS: Partial<Record<string, string>> = {
  gemini: 'gemini',
  codex:  'codex',
  claude: 'claude',
};

// Shell commands used to launch each CLI.
// latest.md is already written by deliver() — pipe it via stdin + fixed system prompt.
const LAUNCH_SHELL: Partial<Record<string, string>> = {
  gemini: `cat .smarthandoff/latest.md | gemini --skip-trust -p "You are resuming a coding task. The context above is a handoff from a previous session. Acknowledge it and ask what to work on next."`,
  codex:  `cat .smarthandoff/latest.md | codex`,
  claude: `cat .smarthandoff/latest.md | claude -p "You are resuming a coding task. Context is above."`,
};

function isBinaryAvailable(bin: string): boolean {
  try { execSync(`which ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export function launchCli(target: string): boolean {
  const bin = LAUNCH_BINS[target];
  const shellCmd = LAUNCH_SHELL[target];
  if (!bin || !shellCmd) return false;
  if (!isBinaryAvailable(bin)) return false;
  spawnSync(shellCmd, { stdio: 'inherit', shell: true });
  return true;
}
