import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AdapterOutput } from '@smarthandoff/core';

export async function deliver(
  output: AdapterOutput,
  opts: { forceClipboard?: boolean; forcePrint?: boolean; cwd?: string } = {}
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
