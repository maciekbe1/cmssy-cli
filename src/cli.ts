#!/usr/bin/env node

import { Command } from 'commander';
import { configureCommand } from './commands/configure.js';
import { deployCommand } from './commands/deploy.js';
import { syncCommand } from './commands/sync.js';
import { initCommand } from './commands/init.js';
import { createCommand } from './commands/create.js';
import { buildCommand } from './commands/build.js';
import { devCommand } from './commands/dev.js';

const program = new Command();

program
  .name('cmssy-forge')
  .description('Unified CLI for building and publishing blocks to Cmssy marketplace')
  .version('0.2.2');

// cmssy-forge init
program
  .command('init')
  .description('Initialize a new BlockForge project')
  .argument('[name]', 'Project name')
  .option('-f, --framework <framework>', 'Framework (react, vue, angular, vanilla)', 'react')
  .action(initCommand);

// cmssy-forge create
const create = program
  .command('create')
  .description('Create a new block or template');

create
  .command('block')
  .description('Create a new block')
  .argument('<name>', 'Block name')
  .action(createCommand.block);

create
  .command('template')
  .description('Create a new page template')
  .argument('<name>', 'Template name')
  .action(createCommand.page);

// cmssy-forge build
program
  .command('build')
  .description('Build all blocks and templates')
  .option('--framework <framework>', 'Framework to use')
  .action(buildCommand);

// cmssy-forge dev
program
  .command('dev')
  .description('Start development server with preview')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(devCommand);

// cmssy-forge configure
program
  .command('configure')
  .description('Configure Cmssy API credentials')
  .option('--api-url <url>', 'Cmssy API URL', 'https://api.cmssy.io/graphql')
  .action(configureCommand);

// cmssy-forge deploy
program
  .command('deploy')
  .description('Publish blocks/templates to Cmssy marketplace')
  .option('--all', 'Deploy all blocks and templates')
  .option('--blocks <names...>', 'Deploy specific blocks')
  .option('--templates <names...>', 'Deploy specific templates')
  .option('--dry-run', 'Preview what would be deployed without publishing')
  .action(deployCommand);

// cmssy-forge sync
program
  .command('sync')
  .description('Pull blocks from Cmssy marketplace to local project')
  .argument('[package]', 'Package slug to sync (e.g., @vendor/blocks.hero)')
  .option('--workspace <id>', 'Workspace ID to sync from')
  .action(syncCommand);

program.parse();
