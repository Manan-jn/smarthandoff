import { promises as fs } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface SmartHandoffConfig {
  projectId: string;
  defaultTarget: string;
  collectors: {
    claudeLogs: { enabled: boolean };
    git: { enabled: boolean; includeDiffs: boolean };
    memory: { enabled: boolean };
  };
  compression: {
    defaultMode: 'lean' | 'rich' | 'debug';
    profiles: {
      lean: { budget: number };
      rich: { budget: number | null };
      debug: { budget: number };
    };
  };
  policy: {
    autoSnapshotOnRateLimit: boolean;
    autoSnapshotOnPreCompact: boolean;
    minFilesChanged: number;
  };
}

const DEFAULT_CONFIG: SmartHandoffConfig = {
  projectId: path.basename(process.cwd()),
  defaultTarget: 'generic',
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

export async function loadConfig(cwd = process.cwd()): Promise<SmartHandoffConfig> {
  const configPath = path.join(cwd, '.smarthandoff', 'config.yaml');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = yaml.load(raw) as Partial<SmartHandoffConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG, projectId: path.basename(cwd) };
  }
}

export async function saveConfig(config: SmartHandoffConfig, cwd = process.cwd()): Promise<void> {
  const configPath = path.join(cwd, '.smarthandoff', 'config.yaml');
  await fs.writeFile(configPath, yaml.dump(config), 'utf8');
}

export async function writeYaml(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, yaml.dump(data), 'utf8');
}
