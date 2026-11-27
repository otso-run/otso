#!/usr/bin/env node

import { program } from 'commander';

program
  .name('otso')
  .description('Otso - Own your digital trails')
  .version('0.1.0');

// Phase 1: Import command
program
  .command('import')
  .description('Import data from configured sources')
  .option('-r, --resume', 'Resume previous session')
  .option('-s, --source <name>', 'Import specific source only')
  .option('-c, --config <path>', 'Path to sources.toml', 'data/config/sources.toml')
  .action(async (options) => {
    const { runImport } = await import('../src/commands/import/index.js');
    await runImport(options);
  });

// Future: Search command (placeholder)
program
  .command('search')
  .description('Search your archive (coming soon)')
  .action(() => {
    console.log('Search command coming soon');
  });

// Future: Publish command (placeholder)
program
  .command('publish')
  .description('Publish to your site (coming soon)')
  .action(() => {
    console.log('Publish command coming soon');
  });

// Future: Config command (placeholder)
program
  .command('config')
  .description('Manage configuration (coming soon)')
  .action(() => {
    console.log('Config command coming soon');
  });

program.parse();
