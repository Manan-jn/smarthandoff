import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateHandoff, getRelativeTime, type Handoff } from '@smarthandoff/core';

export const listCommand = new Command('list')
  .description('List all saved handoffs for this project')
  .option('--limit <n>', 'number of handoffs to show', '10')
  .action(async (options) => {
    const handoffs = await loadAllHandoffs();

    if (handoffs.length === 0) {
      console.log('No handoffs found. Run: smarthandoff snapshot');
      return;
    }

    const recent = handoffs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, parseInt(options.limit as string));

    console.log(`\nSMART HANDOFFS — ${process.cwd()}\n`);

    for (const h of recent) {
      const age = getRelativeTime(h.createdAt);
      const title = h.goals[0]?.title?.slice(0, 50) || 'No goal';
      console.log(`  ${h.id.slice(0, 25)}  ${age.padEnd(12)}  ${title}`);
    }

    console.log(`\nTotal: ${handoffs.length} handoffs`);
    console.log('Run: smarthandoff resume --id <id> --to <tool>');
  });

async function loadAllHandoffs(): Promise<Handoff[]> {
  const handoffsDir = '.smarthandoff/handoffs';
  try {
    const files = await fs.readdir(handoffsDir);
    const results: Handoff[] = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(handoffsDir, file), 'utf8');
        const result = validateHandoff(JSON.parse(raw));
        if (result.success) results.push(result.data as Handoff);
      } catch { /* skip corrupt files */ }
    }
    return results;
  } catch { return []; }
}
