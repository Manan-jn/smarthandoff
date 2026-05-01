import { execSync } from 'node:child_process';
import path from 'node:path';
import type { Handoff, HandoffFileChange, Importance } from '../types.js';

export async function fromGit(
  repoPath: string,
  options: { includeDiffs?: boolean } = {}
): Promise<Partial<Handoff>> {
  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'ignore' });
  } catch {
    return { filesChanged: [] };
  }

  let branch = 'unknown';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch { /* ignore */ }

  let recentCommitLines: string[] = [];
  try {
    recentCommitLines = execSync('git log --oneline -10', { cwd: repoPath, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch { /* ignore */ }

  let statusOutput: string;
  try {
    statusOutput = execSync('git status --porcelain=v1', {
      cwd: repoPath, encoding: 'utf8',
    });
  } catch {
    return { filesChanged: [] };
  }

  const filesChanged: HandoffFileChange[] = statusOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      if (filePath.match(/\.?smarthandoff\//)) return false;
      if (/^(GEMINI|AGENTS|cursor-rules|chatgpt-system)\./.test(filePath.split('/').pop() ?? '')) return false;
      return true;
    })
    .map(line => {
      const statusCode = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      return {
        path: filePath,
        status: parseGitStatus(statusCode),
        summary: '',
        importance: scoreImportance(filePath),
        linesAdded: 0,
        linesRemoved: 0,
      };
    });

  // Get diff stats for uncommitted files
  for (const file of filesChanged) {
    try {
      const diffStat = execSync(
        `git diff --numstat HEAD -- "${file.path}"`,
        { cwd: repoPath, encoding: 'utf8' }
      );
      const parts = diffStat.trim().split('\t');
      file.linesAdded = parseInt(parts[0] ?? '0') || 0;
      file.linesRemoved = parseInt(parts[1] ?? '0') || 0;
    } catch { /* new/untracked */ }
  }

  // Supplement with stats from recently committed files (last 30 commits)
  // so files already committed this session still get accurate line counts
  try {
    const logNumstat = execSync(
      'git log --diff-filter=ACMR --numstat --format="" -30',
      { cwd: repoPath, encoding: 'utf8' }
    );
    const commitStatMap = new Map<string, { linesAdded: number; linesRemoved: number }>();
    for (const line of logNumstat.trim().split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const filePath = parts[2]!.trim();
      if (!commitStatMap.has(filePath)) {
        commitStatMap.set(filePath, {
          linesAdded: parseInt(parts[0] ?? '0') || 0,
          linesRemoved: parseInt(parts[1] ?? '0') || 0,
        });
      }
    }
    // Add committed files not already in filesChanged (from git status)
    for (const [filePath, stats] of commitStatMap) {
      if (filePath.match(/\.?smarthandoff\//)) continue;
      if (!filesChanged.some(f => f.path === filePath)) {
        filesChanged.push({
          path: filePath,
          status: 'modified',
          summary: '',
          importance: scoreImportance(filePath),
          linesAdded: stats.linesAdded,
          linesRemoved: stats.linesRemoved,
        });
      }
    }
  } catch { /* ignore */ }

  // Get diffs if requested
  if (options.includeDiffs) {
    for (const file of filesChanged) {
      try {
        file.diff = execSync(
          `git diff HEAD -- "${file.path}"`,
          { cwd: repoPath, encoding: 'utf8', maxBuffer: 100 * 1024 }
        );
      } catch { /* ignore */ }
    }
  }

  // Find impacted test files
  for (const file of filesChanged) {
    file.testsImpacted = findImpactedTests(file.path, repoPath);
  }

  const gitSummary = [
    `Git branch: ${branch}`,
    recentCommitLines.length > 0
      ? `Recent commits:\n${recentCommitLines.map(l => `  ${l}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');

  return {
    filesChanged,
    notes: gitSummary,
    sources: [{
      tool: 'claude-code',
      collectedAt: new Date().toISOString(),
    }],
  };
}

function scoreImportance(filePath: string): Importance {
  const lower = filePath.toLowerCase();
  if (lower.includes('auth') || lower.includes('security') || lower.includes('password')) return 'critical';
  if (lower.endsWith('.test.ts') || lower.endsWith('.spec.ts') || lower.endsWith('.test.js') || lower.endsWith('.spec.js')) return 'high';
  if (lower.includes('middleware') || lower.includes('model') || lower.includes('router')) return 'high';
  if (lower.includes('config') || lower.includes('types') || lower.endsWith('.d.ts')) return 'medium';
  if (lower.endsWith('.md') || lower.includes('docs/') || lower.includes('readme')) return 'low';
  return 'medium';
}

function parseGitStatus(code: string): HandoffFileChange['status'] {
  const c = code.trim().toUpperCase();
  if (c === 'A' || c === '??') return 'added';
  if (c === 'D') return 'deleted';
  if (c === 'R') return 'renamed';
  return 'modified';
}

function findImpactedTests(filePath: string, repoPath: string): string[] {
  const basename = path.basename(filePath, path.extname(filePath));
  try {
    const result = execSync(
      `git grep -rl "${basename}" -- "*.test.*" "*.spec.*" 2>/dev/null || true`,
      { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    return result.trim().split('\n').filter(Boolean).slice(0, 3);
  } catch {
    return [];
  }
}
