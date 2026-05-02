import { Command, Option } from 'commander';
import { promises as fs } from 'node:fs';
import { toAdapter, type TargetTool, TOOL_BUDGETS, summarize } from '@smarthandoff/core';
import { loadConfig } from '../config.js';
import { deliver, launchCli } from '../deliver/index.js';
import { autoDetectTarget, detectTools } from '../detect/toolDetector.js';
import { buildHandoff } from './_buildHandoff.js';
import { emitEvent } from '../analytics.js';
import ora from 'ora';
import chalk from 'chalk';

export const routeCommand = new Command('route')
  .description('Snapshot current session and deliver to target tool')
  .option('--to <tool>', 'target tool: gemini | codex | cursor | claude | chatgpt | generic')
  .option('--mode <mode>', 'lean | rich | debug', 'rich')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--include-diffs', 'include full file diffs')
  .option('--preview', 'preview briefing without delivering')
  .option('--launch', 'launch the target CLI with the handoff directly')
  .option('--save-only', 'capture and save without delivering to any tool')
  .option('--summary', 'print stats after saving (use with --save-only)')
  .option('--note <text>', 'inject a manual note into the handoff')
  .option('--session-id <id>', 'specific session to route from')
  .option('--summarize [provider/model]', 'LLM pass: auto | claude-cli | anthropic | gemini | openai | provider/model')
  .addOption(new Option('--trigger <trigger>', 'trigger source for analytics').default('manual').hideHelp())
  .addOption(new Option('--source <source>', 'trigger source metadata').default('manual').hideHelp())
  .action(async (options) => {
    const config = await loadConfig();
    const mode = (['lean', 'rich', 'debug'] as const).find(m => m === options.mode) ?? 'rich';

    // --save-only: build + save, no delivery
    if (options.saveOnly) {
      const spinner = ora('Building handoff…').start();
      let handoff;
      try {
        handoff = await buildHandoff(config, {
          sessionId: options.sessionId as string | undefined,
          mode,
          includeDiffs: options.includeDiffs as boolean,
          note: options.note as string | undefined,
        });
        spinner.succeed(chalk.green('Handoff built') + chalk.dim(` · ${handoff.goals.length} goals, ${handoff.filesChanged.length} files`));
      } catch (err) {
        spinner.fail('Failed to build handoff');
        throw err;
      }

      let finalHandoff = handoff;
      const sumOpts = parseSummarize(options.summarize as boolean | string | undefined);
      if (sumOpts !== null) {
        const displayProvider = typeof options.summarize === 'string' ? options.summarize : 'auto';
        const sumSpinner = ora(`Enhancing with ${displayProvider}…`).start();
        try {
          finalHandoff = await summarize(handoff, {
            provider: sumOpts.provider as import('@smarthandoff/core').ProviderName | undefined,
            model: sumOpts.model,
          });
          if (finalHandoff !== handoff) {
            sumSpinner.succeed(chalk.green('Enhanced') + chalk.dim(` · ${finalHandoff.goals[0]?.title ?? 'no goal'}`));
          } else {
            sumSpinner.warn(chalk.yellow('Summarization skipped') + chalk.dim(' (provider unavailable)'));
          }
        } catch {
          sumSpinner.warn(chalk.yellow('Summarization failed') + chalk.dim(' — continuing without LLM pass'));
          finalHandoff = handoff;
        }
      }

      await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
      await fs.writeFile(`.smarthandoff/handoffs/${finalHandoff.id}.json`, JSON.stringify(finalHandoff, null, 2));
      await fs.writeFile('.smarthandoff/latest.json', JSON.stringify(finalHandoff, null, 2));

      console.error('');
      console.error(chalk.bold('✓ Handoff saved') + chalk.dim(` ${finalHandoff.id}`));
      console.error(chalk.dim(`  Goals:     ${finalHandoff.goals.length}`));
      console.error(chalk.dim(`  Decisions: ${finalHandoff.decisions.length}`));
      console.error(chalk.dim(`  Files:     ${finalHandoff.filesChanged.length}`));
      console.error(chalk.dim(`  Blockers:  ${finalHandoff.blockers.length}`));
      console.error(chalk.dim(`  Tokens:    ~${finalHandoff.rawTokenCount.toLocaleString()} raw`));
      if (options.summary) {
        if (finalHandoff.goals[0]) console.error(chalk.dim(`  Goal:    `) + finalHandoff.goals[0].title);
        if (finalHandoff.blockers[0]) console.error(chalk.dim(`  Blocker: `) + finalHandoff.blockers[0].description.slice(0, 80));
      }
      return;
    }

    // Full route: build + save + deliver
    let target: TargetTool;
    if (!options.to) {
      const detectSpinner = ora('Detecting AI tools…').start();
      const detected = await detectTools();
      const lines = (['gemini', 'codex', 'cursor', 'claude'] as const).map(
        t => `  ${detected.includes(t) ? chalk.green('✓') : chalk.dim('✗')} ${t}`
      );
      detectSpinner.stop();
      console.error('\n' + lines.join('\n'));
      target = (await autoDetectTarget()) as TargetTool;
      console.error(chalk.dim('\n  Recommendation: ') + chalk.bold(target));
    } else {
      target = options.to as TargetTool;
    }

    const spinner = ora(`Building handoff for ${chalk.bold(target)}…`).start();
    let handoff;
    try {
      handoff = await buildHandoff(config, {
        sessionId: options.sessionId as string | undefined,
        mode,
        includeDiffs: options.includeDiffs as boolean,
        note: options.note as string | undefined,
      });
      const goalTitle = handoff.goals[0]?.title?.slice(0, 55) ?? '';
      spinner.succeed(
        chalk.green('Session parsed') +
        chalk.dim(` · ${handoff.goals.length} goals, ${handoff.filesChanged.length} files`) +
        (goalTitle ? '\n  ' + chalk.dim('Goal: ') + goalTitle : '')
      );
      if (handoff.blockers[0]) {
        console.error('  ' + chalk.dim('Blocker: ') + handoff.blockers[0].description.slice(0, 60));
      }
    } catch (err) {
      spinner.fail('Failed to build handoff');
      throw err;
    }

    let finalHandoff = handoff;
    const sumOpts = parseSummarize(options.summarize as boolean | string | undefined);
    if (sumOpts !== null) {
      const displayProvider = typeof options.summarize === 'string' ? options.summarize : 'auto';
      const sumSpinner = ora(`Enhancing with ${displayProvider}…`).start();
      try {
        finalHandoff = await summarize(handoff, {
          provider: sumOpts.provider as import('@smarthandoff/core').ProviderName | undefined,
          model: sumOpts.model,
        });
        if (finalHandoff !== handoff) {
          sumSpinner.succeed(chalk.green('Enhanced') + chalk.dim(` · ${finalHandoff.goals[0]?.title ?? 'no goal'}`));
        } else {
          sumSpinner.warn(chalk.yellow('Summarization skipped') + chalk.dim(' (provider unavailable)'));
        }
      } catch {
        sumSpinner.warn(chalk.yellow('Summarization failed') + chalk.dim(' — continuing without LLM pass'));
        finalHandoff = handoff;
      }
    }

    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    await fs.writeFile(`.smarthandoff/handoffs/${finalHandoff.id}.json`, JSON.stringify(finalHandoff, null, 2));
    await fs.writeFile('.smarthandoff/latest.json', JSON.stringify(finalHandoff, null, 2));

    const DEBUG_BUDGET = 100_000;
    const effectiveBudget = (options.budget as number | undefined) ?? (mode === 'debug' ? DEBUG_BUDGET : undefined);
    const output = toAdapter(finalHandoff, target, {
      tokenBudget: effectiveBudget,
      mode,
    });

    const displayBudget = effectiveBudget ?? TOOL_BUDGETS[target] ?? 10_000;
    console.error(
      '  ' + chalk.dim('Compressed: ') +
      chalk.bold(output.tokenCount.toLocaleString()) +
      chalk.dim(` tokens (budget: ${displayBudget.toLocaleString()})`)
    );

    if (options.preview) {
      console.error('\n' + chalk.dim('─'.repeat(50)));
      process.stdout.write(output.text);
      console.error('\n' + chalk.dim('─'.repeat(50)));
      return;
    }

    // When --launch is set, suppress stdout/clipboard output — launchCli handles delivery.
    await deliver(output, { suppressOutput: !!options.launch });

    if (options.launch) {
      const launched = await launchCli(target, output.text);
      if (!launched) {
        console.error(chalk.red(`  ✗ --launch: '${target}' CLI not found in PATH or not supported`));
        if (output.launchCommand) {
          console.error(chalk.dim(`  Run manually: `) + output.launchCommand + chalk.dim('  (paste with Cmd+V / Ctrl+V)'));
        }
      }
    } else if (output.launchCommand) {
      console.error('\n  ' + chalk.dim('Run: ') + chalk.bold(output.launchCommand) + chalk.dim('  — then paste with Cmd+V / Ctrl+V'));
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
