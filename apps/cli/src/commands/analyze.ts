import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  allocateBudget,
  TOOL_BUDGETS,
  validateHandoff,
  type TargetTool,
  type Handoff,
} from '@smarthandoff/core';

export const analyzeCommand = new Command('analyze')
  .description('Inspect a handoff — what was extracted, token allocation, confidence')
  .option('--id <handoffId>', 'handoff ID (default: most recent)')
  .option('--target <tool>', 'show allocation for specific target', 'gemini')
  .option('--verbose', 'show full content of each section')
  .action(async (options) => {
    const handoff = options.id
      ? await loadHandoff(options.id as string)
      : await loadLatestHandoff();

    if (!handoff) {
      console.error('No handoff found. Run: smarthandoff snapshot first.');
      process.exit(1);
    }

    const target = options.target as TargetTool;
    const budgets = allocateBudget(handoff, target);
    const totalBudget = TOOL_BUDGETS[target] ?? 10000;

    console.log(`\nHANDOFF ANALYSIS: ${handoff.id}`);
    console.log(`Created: ${handoff.createdAt} | Source: ${handoff.sources[0]?.tool ?? 'unknown'}`);

    console.log('\nEXTRACTION SOURCES');
    for (const source of handoff.sources) {
      console.log(`  ├── ${source.tool}: session ${source.sessionId?.slice(0, 8) ?? 'unknown'}`);
    }
    console.log(`  └── Raw token count: ~${handoff.rawTokenCount.toLocaleString()}`);

    console.log(`\nTOKEN ALLOCATION (target: ${target}, budget: ${totalBudget.toLocaleString()})`);

    const sections = [
      { name: 'Goal', budget: budgets.goal, count: handoff.goals.length, unit: 'goals' },
      { name: 'Decisions', budget: budgets.decisions, count: handoff.decisions.length, unit: 'decisions' },
      { name: 'Files', budget: budgets.filesChanged, count: handoff.filesChanged.length, unit: 'files' },
      { name: 'Blockers', budget: budgets.blockers, count: handoff.blockers.length, unit: 'blockers' },
      { name: 'Next steps', budget: budgets.nextSteps, count: handoff.nextSteps.length, unit: 'steps' },
      { name: 'CLAUDE.md', budget: budgets.claudeMd, count: handoff.context.claudeMdContent ? 1 : 0, unit: 'files' },
    ];

    for (const s of sections) {
      const barLen = Math.min(20, Math.floor((s.budget / totalBudget) * 20));
      const bar = '█'.repeat(barLen).padEnd(20, '░');
      console.log(`  ${s.name.padEnd(12)} ${bar} ~${Math.floor(s.budget).toLocaleString()} tokens  (${s.count} ${s.unit})`);
    }

    console.log('\nCONFIDENCE SCORES');
    console.log(`  Overall:     ${(handoff.extractionConfidence * 100).toFixed(0)}%`);
    for (const d of handoff.decisions) {
      console.log(`  Decision:    ${(d.confidence * 100).toFixed(0)}%  "${d.summary.slice(0, 60)}..."`);
    }

    if (options.verbose) {
      console.log('\nFULL CONTENT');
      console.log(JSON.stringify(handoff, null, 2));
    }
  });

async function loadHandoff(id: string): Promise<Handoff | null> {
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
