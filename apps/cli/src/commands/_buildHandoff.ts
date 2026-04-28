import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fromClaudeLogs,
  fromGit,
  fromMemory,
  fromManual,
  merge,
  type Handoff,
} from '@smarthandoff/core';
import type { SmartHandoffConfig } from '../config.js';

export async function buildHandoff(
  config: SmartHandoffConfig,
  options: {
    sessionId?: string;
    mode?: 'lean' | 'rich' | 'debug';
    includeDiffs?: boolean;
    note?: string;
  }
): Promise<Handoff> {
  const transcriptPath = options.sessionId
    ? await findTranscript(options.sessionId)
    : await findLatestTranscript();

  const partials: Partial<Handoff>[] = [];

  if (config.collectors.claudeLogs.enabled && transcriptPath) {
    partials.push(await fromClaudeLogs(transcriptPath));
  }

  if (config.collectors.git.enabled) {
    partials.push(await fromGit(process.cwd(), {
      includeDiffs: options.includeDiffs ?? (options.mode === 'rich' || options.mode === 'debug'),
    }));
  }

  if (config.collectors.memory.enabled) {
    partials.push(await fromMemory(process.cwd(), transcriptPath));
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

  const mode = options.mode ?? 'rich';

  return merge(partials, {
    projectRoot: process.cwd(),
    sessionId: options.sessionId,
    createdBy: `${os.userInfo().username}@${os.hostname()}`,
    mode,
  });
}

async function findLatestTranscript(): Promise<string | undefined> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const projectDirs = await fs.readdir(projectsDir);
    const cwd = process.cwd();
    for (const dir of projectDirs) {
      const decoded = dir.replace(/-/g, '/').replace(/^\//, '');
      if (cwd.endsWith(decoded) || decoded.includes(path.basename(cwd))) {
        const projectPath = path.join(projectsDir, dir);
        const files = await fs.readdir(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).map(f => path.join(projectPath, f));
        if (jsonlFiles.length === 0) continue;
        const stats = await Promise.all(jsonlFiles.map(async f => ({ path: f, mtime: (await fs.stat(f)).mtime })));
        stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        return stats[0]?.path;
      }
    }
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
