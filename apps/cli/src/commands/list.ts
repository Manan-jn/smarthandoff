import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateHandoff, getRelativeTime, allocateBudget, TOOL_BUDGETS, type Handoff, type TargetTool } from '@smarthandoff/core';
import chalk from 'chalk';

export const listCommand = new Command('list')
  .description('List all saved handoffs for this project')
  .option('--limit <n>', 'number of handoffs to show', '10')
  .option('--inspect [id]', 'inspect a handoff — token allocation, confidence (default: most recent)')
  .option('--target <tool>', 'target tool for --inspect allocation (default: gemini)', 'gemini')
  .option('--json', 'dump full handoff JSON (use with --inspect)')
  .action(async (options) => {
    if (options.inspect !== undefined) {
      const id = typeof options.inspect === 'string' ? options.inspect : undefined;
      const handoff = id ? await loadHandoffById(id) : await loadLatestHandoff();

      if (!handoff) {
        console.error(chalk.red(id
          ? `No handoff found with id: ${id}`
          : 'No handoffs found. Run: smarthandoff route --save-only'));
        process.exit(1);
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(handoff, null, 2) + '\n');
        return;
      }

      const target = options.target as TargetTool;
      const budgets = allocateBudget(handoff, target);
      const totalBudget = TOOL_BUDGETS[target] ?? 10_000;

      console.error('');
      console.error(chalk.bold('HANDOFF') + ' ' + chalk.dim(handoff.id));
      console.error(chalk.dim(`Created: ${handoff.createdAt} · Source: ${handoff.sources[0]?.tool ?? 'unknown'}`));

      console.error('\n' + chalk.bold('EXTRACTION SOURCES'));
      for (const source of handoff.sources) {
        console.error(chalk.dim(`  ├── ${source.tool}: session ${source.sessionId?.slice(0, 8) ?? 'unknown'}`));
      }
      console.error(chalk.dim(`  └── Raw token count: ~${handoff.rawTokenCount.toLocaleString()}`));

      console.error(`\n${chalk.bold('TOKEN ALLOCATION')} ${chalk.dim(`(target: ${target}, budget: ${totalBudget.toLocaleString()})`)}`);
      const sections = [
        { name: 'Goal',       budget: budgets.goal,         count: handoff.goals.length,        unit: 'goals' },
        { name: 'Decisions',  budget: budgets.decisions,    count: handoff.decisions.length,    unit: 'decisions' },
        { name: 'Files',      budget: budgets.filesChanged, count: handoff.filesChanged.length, unit: 'files' },
        { name: 'Blockers',   budget: budgets.blockers,     count: handoff.blockers.length,     unit: 'blockers' },
        { name: 'Next steps', budget: budgets.nextSteps,    count: handoff.nextSteps.length,    unit: 'steps' },
        { name: 'CLAUDE.md',  budget: budgets.claudeMd,     count: handoff.context.claudeMdContent ? 1 : 0, unit: 'files' },
      ];
      for (const s of sections) {
        const filled = Math.min(20, Math.floor((s.budget / totalBudget) * 20));
        const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(20 - filled));
        const tokens = chalk.bold(`~${Math.floor(s.budget).toLocaleString()}`) + chalk.dim(' tokens');
        const count = chalk.dim(`(${s.count} ${s.unit})`);
        console.error(`  ${s.name.padEnd(12)} ${bar} ${tokens}  ${count}`);
      }

      console.error('\n' + chalk.bold('CONFIDENCE SCORES'));
      const pct = handoff.extractionConfidence * 100;
      const overallColor = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
      console.error(`  Overall:  ${overallColor(`${pct.toFixed(0)}%`)}`);
      for (const d of handoff.decisions) {
        const dp = d.confidence * 100;
        const dColor = dp >= 80 ? chalk.green : dp >= 50 ? chalk.yellow : chalk.red;
        console.error(`  Decision: ${dColor(`${dp.toFixed(0)}%`)}  ${chalk.dim(`"${d.summary.slice(0, 60)}"`)}`);
      }
      return;
    }

    // Default: list handoffs table
    const handoffs = await loadAllHandoffs();

    if (handoffs.length === 0) {
      console.error(chalk.dim('No handoffs found. Run: smarthandoff route --save-only'));
      return;
    }

    const recent = handoffs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, parseInt(options.limit as string));

    const idWidth = Math.max(...recent.map(h => h.id.length));

    console.error('\n' + chalk.bold('SMART HANDOFFS') + chalk.dim(` — ${process.cwd()}`) + '\n');

    for (const h of recent) {
      const age = getRelativeTime(h.createdAt);
      const title = h.goals[0]?.title?.slice(0, 50) || chalk.dim('No goal');
      console.error(
        '  ' + chalk.dim(h.id.padEnd(idWidth)) +
        '  ' + chalk.dim(age.padEnd(12)) +
        '  ' + title
      );
    }

    console.error('\n' + chalk.dim(`Total: ${handoffs.length} handoffs`));
    console.error(chalk.dim('Run: smarthandoff resume --id <id> --to <tool>'));
  });

async function loadAllHandoffs(): Promise<Handoff[]> {
  const handoffsDir = '.smarthandoff/handoffs';
  try {
    const files = await fs.readdir(handoffsDir);
    const results: Handoff[] = [];
    for (const file of files.filter((f: string) => f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(handoffsDir, file), 'utf8');
        const result = validateHandoff(JSON.parse(raw));
        if (result.success) results.push(result.data as Handoff);
      } catch { /* skip corrupt files */ }
    }
    return results;
  } catch { return []; }
}

async function loadHandoffById(id: string): Promise<Handoff | null> {
  try {
    const raw = await fs.readFile(path.join('.smarthandoff', 'handoffs', `${id}.json`), 'utf8');
    const result = validateHandoff(JSON.parse(raw));
    return result.success ? (result.data as Handoff) : null;
  } catch { return null; }
}

async function loadLatestHandoff(): Promise<Handoff | null> {
  try {
    const raw = await fs.readFile('.smarthandoff/latest.json', 'utf8');
    const result = validateHandoff(JSON.parse(raw));
    return result.success ? (result.data as Handoff) : null;
  } catch { return null; }
}
