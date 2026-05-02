#!/usr/bin/env node
import { program } from 'commander';
import { createRequire } from 'node:module';
import { initCommand } from './commands/init.js';
import { resumeCommand } from './commands/resume.js';
import { routeCommand } from './commands/route.js';
import { listCommand } from './commands/list.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

program
  .name('smarthandoff')
  .alias('shoff')
  .description('Smart Handoff — zero-friction AI session continuity')
  .version(version);

program.addCommand(initCommand);
program.addCommand(resumeCommand);
program.addCommand(routeCommand);
program.addCommand(listCommand);

program.parse();
