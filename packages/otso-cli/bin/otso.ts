#!/usr/bin/env bun

import { program } from 'commander';

program
  .name('otso')
  .description('Otso - Own your digital trails')
  .version('0.1.0')
  .addHelpText(
    'after',
    `
Typical flow:
  otso sources                     list what can be imported and how
  otso auth arena                  connect an API source (token saved to ~/.otso/config)
  otso sync arena                  fetch new data (safe to repeat; run it on a schedule)
  otso ingest spotify ~/Downloads/my_spotify_data.zip
  otso sync safari                 read a local macOS database
  otso index                       rebuild the search index from data/sources
  otso schedule install --every 60 sync every hour from this Mac (launchd)
  otso status                      what's connected and how much is stored
  otso archive foursquare          stop syncing a source you no longer use (its data stays)
  otso log                         recent runs, and slow or failing sources`
  );

program
  .command('import')
  .description('Guided setup in the terminal UI')
  .option('-r, --resume', 'Resume previous session')
  .option('-s, --source <name>', 'Import specific source only')
  .option('-c, --config <path>', 'Path to sources.toml', 'data/config/sources.toml')
  .action(async (options) => {
    const { runImport } = await import('../src/commands/import/index.js');
    await runImport(options);
  });

program
  .command('sources')
  .description('List supported sources and how each is imported')
  .action(async () => (await import('../src/commands/cli.js')).sourcesCommand());

program
  .command('status')
  .description('Show which sources are connected and how much data each holds')
  .action(async () => (await import('../src/commands/cli.js')).statusCommand());

program
  .command('auth <source>')
  .description('Connect an API source and save its token (verified first)')
  .option('--logout', 'Remove saved credentials for this source')
  .option('--no-open', "Don't open the setup page in a browser")
  .action(async (source, opts) => (await import('../src/commands/cli.js')).authCommand(source, opts));

program
  .command('sync [sources...]')
  .description('Fetch new data from API and local sources (all connected ones by default)')
  .option('--full', 'Ignore saved cursors and re-fetch everything')
  .option('-i, --index', 'Run the indexer afterwards')
  .action(async (sources, opts) => (await import('../src/commands/cli.js')).syncCommand(sources, opts));

program
  .command('ingest <source> [files...]')
  .description('Process a downloaded export (zip, folder, json or csv); without a file, shows how to get one')
  .option('-i, --index', 'Run the indexer afterwards')
  .action(async (source, files, opts) => (await import('../src/commands/cli.js')).ingestCommand(source, files, opts));

program
  .command('index')
  .description('Build the event store and search index from data/sources with otso-indexer')
  .option('-s, --source <name>', 'Index one sources.toml entry only')
  .option('--fixtures', 'Index data/fixtures (mock data) instead')
  .option('--fresh', 'Move the current index aside and rebuild it from scratch')
  .action(async (opts) => (await import('../src/commands/cli.js')).indexCommand(opts));

program
  .command('log')
  .description('Show recent sync and index runs, and which sources are slow or failing')
  .option('-n, --limit <runs>', 'How many runs to show', '10')
  .option('-s, --source <name>', 'One source only')
  .option('--kind <kind>', 'sync or index')
  .option('--json', 'Print the log entries as JSON lines')
  .action(async (opts) => (await import('../src/commands/log.js')).logCommand(opts));

program
  .command('config [action] [key] [value]')
  .description('Show where otso keeps data, or: config set data-dir|sources-dir|indexer <path> | config unset <key>')
  .action(async (action, key, value) => (await import('../src/commands/cli.js')).configCommand(action, key, value));

program
  .command('migrate <from>')
  .description('Import credentials from another tool; "chronicle" reads ~/.config/chronicle/etl (values are never printed)')
  .option('--dir <path>', 'chronicle-etl config folder', '~/.config/chronicle/etl')
  .option('--no-verify', 'Save without checking each token with its service')
  .option('--overwrite', 'Replace credentials otso already has')
  .action(async (from, opts) => (await import('../src/commands/cli.js')).migrateCommand(from, opts));

program
  .command('adopt <from>')
  .description('Bring an existing archive into sources-dir with otso ids, so syncs continue from it (the archive is read-only)')
  .requiredOption('--archive <path>', 'Chronicle data folder (the one holding <source>/chronicle/chronicle.db)')
  .option('--only <sources>', 'Comma-separated list, e.g. pinboard,lastfm')
  .action(async (from, opts) => (await import('../src/commands/cli.js')).adoptCommand(from, opts));

program
  .command('schedule [action] [sources...]')
  .description('Sync on a timer with a launchd agent: schedule install [sources...] | uninstall | status')
  .option('--every <minutes>', 'How often to sync', '60')
  .option('-i, --index', 'Run the indexer after each sync (on the Mac that holds the index)')
  .option('--dry-run', 'Print the launchd plist instead of installing it')
  .action(async (action, sources, opts) => {
    try {
      await (await import('../src/commands/schedule.js')).scheduleCommand(action, sources, opts);
    } catch (err) {
      console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('archive [sources...]')
  .description("Mark sources you no longer use: their data stays searchable, but sync skips them. With no names, lists them")
  .action(async (sources) => (await import('../src/commands/cli.js')).archiveCommand(sources));

program
  .command('unarchive <sources...>')
  .description('Sync archived sources again')
  .action(async (sources) => (await import('../src/commands/cli.js')).unarchiveCommand(sources));

program
  .command('search')
  .description('Search your archive (coming soon)')
  .action(() => {
    console.log('Search command coming soon; run otso-search (packages/otso-search) for now');
  });

program
  .command('publish')
  .description('Publish to your site (coming soon)')
  .action(() => {
    console.log('Publish command coming soon');
  });

await program.parseAsync();
