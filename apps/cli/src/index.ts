#!/usr/bin/env node
import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { snapshotCommand } from './commands/snapshot.js';
import { resumeCommand } from './commands/resume.js';
import { routeCommand } from './commands/route.js';
import { analyzeCommand } from './commands/analyze.js';
import { listCommand } from './commands/list.js';

program
  .name('smarthandoff')
  .alias('shoff')
  .description('Smart Handoff — zero-friction AI session continuity')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(snapshotCommand);
program.addCommand(resumeCommand);
program.addCommand(routeCommand);
program.addCommand(analyzeCommand);
program.addCommand(listCommand);

program.parse();
