import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { toAdapter, validateHandoff, type TargetTool, type Handoff, TOOL_BUDGETS, summarize } from '@smarthandoff/core';
import { loadConfig } from '../config.js';
import { deliver } from '../deliver/index.js';
import { autoDetectTarget, detectTools } from '../detect/toolDetector.js';
import { buildHandoff } from './_buildHandoff.js';
import { emitEvent } from '../analytics.js';

export const routeCommand = new Command('route')
  .description('Snapshot current session and deliver to target tool (one command)')
  .option('--to <tool>', 'target tool: gemini | codex | cursor | claude | chatgpt | generic')
  .option('--mode <mode>', 'lean | rich | debug', 'rich')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--include-diffs', 'include full file diffs')
  .option('--preview', 'preview briefing without delivering')
  .option('--trigger <trigger>', 'trigger source (manual|rate_limit|precompact)', 'manual')
  .option('--session-id <id>', 'specific session to route from')
  .option('--summarize [provider/model]', 'LLM pass: auto | claude-cli | anthropic | gemini | openai | provider/model')
  .action(async (options) => {
    const config = await loadConfig();

    // Determine target tool
    let target: TargetTool;
    if (!options.to) {
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

    // Optional LLM summarization pass
    let finalHandoff = handoff;
    const sumOpts = parseSummarize(options.summarize as boolean | string | undefined);
    if (sumOpts !== null) {
      const displayProvider = typeof options.summarize === 'string' ? options.summarize : 'auto';
      console.log(`\n  Running LLM summarization (${displayProvider})...`);
      finalHandoff = await summarize(handoff, {
        provider: sumOpts.provider as import('@smarthandoff/core').ProviderName | undefined,
        model: sumOpts.model,
      });
      if (finalHandoff !== handoff) {
        console.log(`  ✓ Enhanced: ${finalHandoff.goals[0]?.title ?? 'no goal'}`);
      }
    }

    // Save snapshot
    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    await fs.writeFile(`.smarthandoff/handoffs/${finalHandoff.id}.json`, JSON.stringify(finalHandoff, null, 2));
    await fs.writeFile('.smarthandoff/latest.json', JSON.stringify(finalHandoff, null, 2));

    // Generate adapter output
    const DEBUG_BUDGET = 100_000;
    const effectiveBudget = (options.budget as number | undefined) ?? (mode === 'debug' ? DEBUG_BUDGET : undefined);
    const output = toAdapter(finalHandoff, target, {
      tokenBudget: effectiveBudget,
      mode,
    });

    const displayBudget = effectiveBudget ?? TOOL_BUDGETS[target] ?? 10_000;
    console.log(`  ✓ Compressed: ${output.tokenCount.toLocaleString()} tokens (budget: ${displayBudget.toLocaleString()})`);

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
      handoffId: finalHandoff.id,
      targetTool: target,
      trigger: options.trigger as string,
      tokenCount: output.tokenCount,
    });
  });

function parseSummarize(val: boolean | string | undefined): { provider?: string; model?: string } | null {
  if (val === undefined || val === false) return null;
  if (val === true) return {};
  const [provider, model] = String(val).split('/');
  return {
    provider: provider?.trim() || undefined,
    model: model?.trim() || undefined,
  };
}
