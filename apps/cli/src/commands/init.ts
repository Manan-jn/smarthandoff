import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeYaml } from '../config.js';
import { detectTools } from '../detect/toolDetector.js';

export const initCommand = new Command('init')
  .description('Initialize Smart Handoff in this project')
  .option('--target <tool>', 'default target tool (gemini|codex|cursor|claude|chatgpt|generic)')
  .option('--no-hooks', 'skip Claude Code hooks registration')
  .action(async (options) => {
    console.log('Initializing Smart Handoff...\n');

    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    await fs.mkdir('.smarthandoff/cache', { recursive: true });

    const detected = await detectTools();
    const defaultTarget = options.target || detected[0] || 'generic';

    console.log('Detected tools:');
    for (const tool of ['gemini', 'codex', 'cursor', 'claude']) {
      const found = detected.includes(tool);
      console.log(`  ${found ? '✓' : '✗'} ${tool}`);
    }

    const config = {
      projectId: path.basename(process.cwd()),
      defaultTarget,
      collectors: {
        claudeLogs: { enabled: true },
        git: { enabled: true, includeDiffs: false },
        memory: { enabled: true },
      },
      compression: {
        defaultMode: 'rich',
        profiles: {
          lean: { budget: 4000 },
          rich: { budget: null },
          debug: { budget: 100000 },
        },
      },
      policy: {
        autoSnapshotOnRateLimit: true,
        autoSnapshotOnPreCompact: true,
        minFilesChanged: 1,
      },
    };

    await writeYaml('.smarthandoff/config.yaml', config);
    console.log('\n✓ Created .smarthandoff/config.yaml');

    if (options.hooks !== false) {
      try {
        await registerClaudeHooks(defaultTarget);
        console.log('✓ Registered Claude Code hooks:');
        console.log('    PreCompact → auto-snapshot when context fills');
        console.log('    StopFailure[rate_limit] → auto-route when rate limited');
      } catch (err) {
        console.log('⚠ Could not register hooks:', (err as Error).message);
      }
    }

    await appendToGitignore(['.smarthandoff/cache/', '.smarthandoff/events.jsonl', '.smarthandoff/latest.md']);

    console.log('\n✅ Smart Handoff initialized!');
    console.log('   Run: smarthandoff route --to <tool>  when you need to switch');
    console.log('   Or just hit your rate limit — it auto-fires 🚀');
  });

async function registerClaudeHooks(defaultTarget: string): Promise<void> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch { /* doesn't exist yet */ }

  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  const stopFailureHooks = (hooks.StopFailure || []) as unknown[];
  const alreadyHasStopFailure = stopFailureHooks.some(
    (h: unknown) => typeof h === 'object' && h !== null && JSON.stringify(h).includes('smarthandoff')
  );

  if (!alreadyHasStopFailure) {
    hooks.StopFailure = [
      ...stopFailureHooks,
      {
        matcher: 'rate_limit',
        hooks: [{
          type: 'command',
          command: `smarthandoff route --to ${defaultTarget} --trigger rate_limit`,
          timeout: 60,
        }],
      },
    ];
  }

  const preCompactHooks = (hooks.PreCompact || []) as unknown[];
  const alreadyHasPreCompact = preCompactHooks.some(
    (h: unknown) => typeof h === 'object' && h !== null && JSON.stringify(h).includes('smarthandoff')
  );

  if (!alreadyHasPreCompact) {
    hooks.PreCompact = [
      ...preCompactHooks,
      {
        matcher: 'auto',
        hooks: [{
          type: 'command',
          command: 'smarthandoff snapshot --mode lean --source precompact',
          async: true,
          timeout: 30,
        }],
      },
    ];
  }

  settings.hooks = hooks;
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

async function appendToGitignore(entries: string[]): Promise<void> {
  let existing = '';
  try {
    existing = await fs.readFile('.gitignore', 'utf8');
  } catch { /* no .gitignore */ }

  const toAdd = entries.filter(e => !existing.includes(e));
  if (toAdd.length === 0) return;

  const addition = '\n# Smart Handoff\n' + toAdd.join('\n') + '\n';
  await fs.appendFile('.gitignore', addition, 'utf8');
}
