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
const LAUNCH_BINS: Record<string, string> = {
  gemini: 'gemini',
  codex:  'codex',
  claude: 'claude',
};

// Flags passed directly to the binary — no pipe, keeps stdin as the real TTY
const LAUNCH_ARGS: Partial<Record<string, string[]>> = {
  gemini: ['--skip-trust'],
  codex:  [],
  claude: [],
};

function isBinaryAvailable(bin: string): boolean {
  try { execSync(`which ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export async function launchCli(target: string, content: string): Promise<boolean> {
  const bin = LAUNCH_BINS[target];
  const args = LAUNCH_ARGS[target];
  if (!bin || !args) return false;
  if (!isBinaryAvailable(bin)) return false;

  // Copy formatted prompt to clipboard so the user can paste it as their first message
  await copyToClipboard(content);
  process.stderr.write('\n  ✓ Handoff copied to clipboard\n');
  process.stderr.write(`  Paste it (Cmd+V / Ctrl+V) as your first message in ${target}.\n\n`);

  spawnSync(bin, args, { stdio: 'inherit' });
  return true;
}
