import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Handoff } from '../types.js';

export async function fromMemory(
  projectRoot: string,
  _transcriptPath?: string
): Promise<Partial<Handoff>> {
  // Claude Code encodes paths: replace / and whitespace with -, keeping leading -
  const encoded = projectRoot.replace(/[/\s]/g, '-');
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');

  let notes = '';

  try {
    const files = await fs.readdir(memoryDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    const contents: string[] = [];
    for (const file of mdFiles.slice(0, 10)) {
      try {
        const content = await fs.readFile(path.join(memoryDir, file), 'utf8');
        // Strip frontmatter
        const stripped = content.replace(/^---[\s\S]*?---\n*/m, '').trim();
        if (stripped) contents.push(stripped);
      } catch { /* ignore */ }
    }

    notes = contents.join('\n\n---\n\n');
  } catch {
    // No memory directory — that's fine
  }

  return notes ? { notes } : {};
}
