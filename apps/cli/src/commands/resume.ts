import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { toAdapter, validateHandoff, type TargetTool, type Handoff } from '@smarthandoff/core';
import { deliver } from '../deliver/index.js';
import chalk from 'chalk';

export const resumeCommand = new Command('resume')
  .description('Generate a target-tool prompt from a saved handoff')
  .option('--id <handoffId>', 'handoff ID (default: most recent)')
  .option('--to <tool>', 'target tool: gemini | codex | cursor | claude | chatgpt | generic', 'generic')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--copy', 'force copy to clipboard')
  .option('--print', 'print briefing to stdout instead of delivering')
  .action(async (options) => {
    const handoff = options.id
      ? await loadHandoff(options.id as string)
      : await loadLatestHandoff();

    if (!handoff) {
      console.error(chalk.red('No handoff found.') + chalk.dim(' Run: smarthandoff route --save-only first.'));
      process.exit(1);
    }

    const target = options.to as TargetTool;
    const output = toAdapter(handoff, target, {
      tokenBudget: options.budget as number | undefined,
    });

    await deliver(output, { forceClipboard: options.copy as boolean, forcePrint: options.print as boolean });

    if (output.launchCommand && !options.print) {
      console.error('\n  ' + chalk.dim('Run: ') + chalk.bold(output.launchCommand) + chalk.dim('  — then paste with Cmd+V / Ctrl+V'));
    }
  });

async function loadHandoff(id: string): Promise<Handoff | null> {
  const handoffPath = path.join('.smarthandoff', 'handoffs', `${id}.json`);
  try {
    const raw = await fs.readFile(handoffPath, 'utf8');
    const result = validateHandoff(JSON.parse(raw));
    return result.success ? (result.data as Handoff) : null;
  } catch {
    return null;
  }
}

async function loadLatestHandoff(): Promise<Handoff | null> {
  try {
    const raw = await fs.readFile('.smarthandoff/latest.json', 'utf8');
    const result = validateHandoff(JSON.parse(raw));
    return result.success ? (result.data as Handoff) : null;
  } catch {
    return null;
  }
}
