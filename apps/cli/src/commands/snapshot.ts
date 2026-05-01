import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fromClaudeLogs,
  fromGit,
  fromMemory,
  fromManual,
  merge,
  summarize,
  type Handoff,
} from '@smarthandoff/core';
import { loadConfig } from '../config.js';

export const snapshotCommand = new Command('snapshot')
  .description('Create a handoff from current session state')
  .option('--mode <mode>', 'lean | rich | debug', 'rich')
  .option('--session-id <id>', 'specific Claude session ID (default: most recent)')
  .option('--budget <tokens>', 'override token budget', parseInt)
  .option('--note <text>', 'add a manual note to the handoff')
  .option('--source <source>', 'trigger source (manual|precompact|stop)', 'manual')
  .option('--print', 'print handoff summary to stdout')
  .option('--summarize', 'LLM summarization pass for higher-quality handoff')
  .option('--summarize-provider <p>', 'claude-cli | anthropic | gemini | openai (auto-detects from env vars)')
  .option('--summarize-model <model>', 'model override for summarization provider')
  .action(async (options) => {
    const config = await loadConfig();

    const transcriptPath = options.sessionId
      ? await findTranscript(options.sessionId)
      : await findLatestTranscript();

    const partials: Partial<Handoff>[] = [];

    if (config.collectors.claudeLogs.enabled && transcriptPath) {
      const logPartial = await fromClaudeLogs(transcriptPath, { projectRoot: process.cwd() });
      partials.push(logPartial);
    }

    if (config.collectors.git.enabled) {
      const gitPartial = await fromGit(process.cwd(), {
        includeDiffs: options.mode === 'rich' || options.mode === 'debug',
      });
      partials.push(gitPartial);
    }

    if (config.collectors.memory.enabled) {
      const memPartial = await fromMemory(process.cwd(), transcriptPath);
      partials.push(memPartial);
    }

    if (options.note) {
      partials.push(fromManual({ note: options.note }));
    }

    try {
      const claudeMd = await fs.readFile(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
      partials.push({ context: { claudeMdContent: claudeMd, stack: [] } });
    } catch { /* no CLAUDE.md */ }

    try {
      const pkgRaw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      partials.push({
        context: {
          stack: detectStack(pkg),
          packageJson: {
            name: (pkg.name as string) || '',
            version: (pkg.version as string) || '',
            dependencies: {
              ...((pkg.dependencies as Record<string, string>) || {}),
              ...((pkg.devDependencies as Record<string, string>) || {}),
            },
          },
        },
      });
    } catch { /* no package.json */ }

    const mode = (['lean', 'rich', 'debug'] as const).includes(options.mode)
      ? (options.mode as 'lean' | 'rich' | 'debug')
      : 'rich';

    const handoff = merge(partials, {
      projectRoot: process.cwd(),
      sessionId: options.sessionId as string | undefined,
      createdBy: `${os.userInfo().username}@${os.hostname()}`,
      mode,
    });

    let finalHandoff = handoff;
    if (options.summarize) {
      const provider = (options.summarizeProvider as string | undefined) ?? 'auto';
      console.log(`  Running LLM summarization (provider: ${provider})...`);
      finalHandoff = await summarize(handoff, {
        provider: options.summarizeProvider as import('@smarthandoff/core').ProviderName | undefined,
        model: options.summarizeModel as string | undefined,
      });
      if (finalHandoff !== handoff) {
        console.log(`  ✓ Enhanced: ${finalHandoff.goals[0]?.title ?? 'no goal'}`);
      }
    }

    await fs.mkdir('.smarthandoff/handoffs', { recursive: true });
    const savePath = `.smarthandoff/handoffs/${finalHandoff.id}.json`;
    await fs.writeFile(savePath, JSON.stringify(finalHandoff, null, 2));
    await fs.writeFile('.smarthandoff/latest.json', JSON.stringify(finalHandoff, null, 2));

    console.log(`✓ Handoff created: ${finalHandoff.id}`);
    console.log(`  Goals:     ${handoff.goals.length}`);
    console.log(`  Decisions: ${handoff.decisions.length}`);
    console.log(`  Files:     ${handoff.filesChanged.length}`);
    console.log(`  Blockers:  ${handoff.blockers.length}`);
    console.log(`  Tokens:    ~${handoff.rawTokenCount.toLocaleString()} raw`);

    if (options.print) {
      console.log('\n--- HANDOFF SUMMARY ---');
      console.log(formatHandoffSummary(finalHandoff));
    }
  });

async function findLatestTranscript(): Promise<string | undefined> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  // Claude Code encodes paths: replace / and whitespace with -
  const encodedCwd = process.cwd().replace(/[/\s]/g, '-');
  const projectPath = path.join(projectsDir, encodedCwd);
  try {
    const files = await fs.readdir(projectPath);
    const jsonlFiles = files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(projectPath, f));
    if (jsonlFiles.length === 0) return undefined;
    const stats = await Promise.all(
      jsonlFiles.map(async f => ({ path: f, mtime: (await fs.stat(f)).mtime }))
    );
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return stats[0]?.path;
  } catch { /* no transcripts */ }
  return undefined;
}

async function findTranscript(sessionId: string): Promise<string | undefined> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const projectDirs = await fs.readdir(projectsDir);
    for (const dir of projectDirs) {
      const projectPath = path.join(projectsDir, dir);
      const files = await fs.readdir(projectPath);
      const match = files.find(f => f.includes(sessionId) && f.endsWith('.jsonl'));
      if (match) return path.join(projectPath, match);
    }
  } catch { /* ignore */ }
  return undefined;
}

function detectStack(pkg: Record<string, unknown>): string[] {
  const stack: string[] = [];
  const deps = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };

  if (deps['typescript']) stack.push(`TypeScript ${deps['typescript']}`);
  if (deps['react']) stack.push(`React ${deps['react']}`);
  if (deps['next']) stack.push(`Next.js ${deps['next']}`);
  if (deps['express']) stack.push(`Express ${deps['express']}`);
  if (deps['fastify']) stack.push(`Fastify ${deps['fastify']}`);
  if (deps['vitest']) stack.push('Vitest');
  if (deps['jest']) stack.push('Jest');
  stack.push(`Node ${process.version}`);

  return stack;
}

function formatHandoffSummary(handoff: Handoff): string {
  const lines: string[] = [];
  if (handoff.goals[0]) lines.push(`Goal: ${handoff.goals[0].title}`);
  if (handoff.blockers[0]) lines.push(`Blocker: ${handoff.blockers[0].description.slice(0, 100)}`);
  for (const f of handoff.filesChanged.slice(0, 5)) {
    lines.push(`  File: ${f.path}`);
  }
  return lines.join('\n');
}
