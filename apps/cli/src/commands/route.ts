import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { toAdapter, validateHandoff, type TargetTool, type Handoff, TOOL_BUDGETS } from '@smarthandoff/core';
import { loadConfig } from '../config.js';
import { deliver } from '../deliver/index.js';
import { autoDetectTarget, detectTools } from '../detect/toolDetector.js';
import { buildHandoff } from './_buildHandoff.js';
import { emitEvent } from '../analytics.js';

export const routeCommand = new Command('route')
  .description('Snapshot current session and deliver to target tool (one command)')
  .option('--to <tool>', 'target tool: gemini | codex | cursor | claude | chatgpt | generic')
  .option('--auto', 'auto-detect best available tool')
  .option('--mode <mode>', 'lean | rich', 'rich')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--include-diffs', 'include full file diffs')
  .option('--preview', 'preview briefing without delivering')
  .option('--trigger <trigger>', 'trigger source (manual|rate_limit|precompact)', 'manual')
  .option('--session-id <id>', 'specific session to route from')
  .action(async (options) => {
    const config = await loadConfig();

    // Determine target tool
    let target: TargetTool;
    if (options.auto || !options.to) {
      const detected = await detectTools();
      console.log('\nDetecting available AI tools...');
      for (const tool of ['gemini', 'codex', 'cursor', 'claude']) {
        console.log(`  ${detected.includes(tool) ? '✓' : '✗'} ${tool}`);
      }
      target = (await autoDetectTarget()) as TargetTool;
      console.log(`\n  Recommendation: ${target}`);
    } else {
      target = options.to as TargetTool;
    }

    console.log(`\nBuilding handoff for ${target}...`);
    const mode = (['lean', 'rich', 'debug'] as const).find(m => m === options.mode) ?? 'rich';

    const handoff = await buildHandoff(config, {
      sessionId: options.sessionId as string | undefined,
      mode,
      includeDiffs: options.includeDiffs as boolean,
    });

    console.log(`  ✓ Session parsed (${handoff.goals.length} goals, ${handoff.filesChanged.length} files)`);
    if (handoff.goals[0]) console.log(`  ✓ Goal: ${handoff.goals[0].title}`);
    if (handoff.blockers[0]) console.log(`  ✓ Blocker: ${handoff.blockers[0].description.slice(0, 60)}`);

    // Save snapshot
    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    await fs.writeFile(`.smarthandoff/handoffs/${handoff.id}.json`, JSON.stringify(handoff, null, 2));
    await fs.writeFile('.smarthandoff/latest.json', JSON.stringify(handoff, null, 2));

    // Generate adapter output
    const output = toAdapter(handoff, target, {
      tokenBudget: options.budget as number | undefined,
      mode,
    });

    console.log(`  ✓ Compressed: ${output.tokenCount.toLocaleString()} tokens (budget: ${(TOOL_BUDGETS[target] ?? 10000).toLocaleString()})`);

    if (options.preview) {
      console.log('\n--- PREVIEW ---');
      console.log(output.text);
      console.log('--- END PREVIEW ---');
      return;
    }

    console.log(`\nDelivering to ${target}...`);
    await deliver(output);

    if (output.launchCommand) {
      console.log(`\nRun: ${output.launchCommand}`);
    }

    await emitEvent({
      type: 'ROUTE_TRIGGERED',
      handoffId: handoff.id,
      targetTool: target,
      trigger: options.trigger as string,
      tokenCount: output.tokenCount,
    });
  });
