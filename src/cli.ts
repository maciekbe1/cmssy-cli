#!/usr/bin/env node

import { Command } from "commander";
import { buildCommand } from "./commands/build.js";
import { configureCommand } from "./commands/configure.js";
import { createCommand } from "./commands/create.js";
import { devCommand } from "./commands/dev.js";
import { initCommand } from "./commands/init.js";
import { syncCommand } from "./commands/sync.js";
import { migrateCommand } from "./commands/migrate.js";
import { publishCommand } from "./commands/publish.js";

const program = new Command();

program
  .name("cmssy")
  .description(
    "Unified CLI for building and publishing blocks to Cmssy marketplace"
  )
  .version("0.8.0");

// cmssy init
program
  .command("init")
  .description("Initialize a new Cmssy project")
  .argument("[name]", "Project name")
  .option(
    "-f, --framework <framework>",
    "Framework (react, vue, angular, vanilla)",
    "react"
  )
  .action(initCommand);

// cmssy create
const create = program
  .command("create")
  .description("Create a new block or template");

create
  .command("block")
  .description("Create a new block")
  .argument("<name>", "Block name")
  .action(createCommand.block);

create
  .command("template")
  .description("Create a new page template")
  .argument("<name>", "Template name")
  .action(createCommand.page);

// cmssy build
program
  .command("build")
  .description("Build all blocks and templates")
  .option("--framework <framework>", "Framework to use")
  .action(buildCommand);

// cmssy dev
program
  .command("dev")
  .description("Start development server with preview")
  .option("-p, --port <port>", "Port number", "3000")
  .action(devCommand);

// cmssy configure
program
  .command("configure")
  .description("Configure Cmssy API credentials")
  .option("--api-url <url>", "Cmssy API URL", "https://api.cmssy.io/graphql")
  .action(configureCommand);

// cmssy publish
program
  .command("publish [packages...]")
  .description("Publish blocks/templates to marketplace or workspace")
  .option("-m, --marketplace", "Publish to public marketplace (requires review)")
  .option("-w, --workspace [id]", "Publish to workspace (private, no review)")
  .option("--all", "Publish all blocks and templates")
  .option("--patch", "Bump patch version (1.0.0 -> 1.0.1)")
  .option("--minor", "Bump minor version (1.0.0 -> 1.1.0)")
  .option("--major", "Bump major version (1.0.0 -> 2.0.0)")
  .option("--dry-run", "Preview what would be published without uploading")
  .action(publishCommand);

// cmssy sync
program
  .command("sync")
  .description("Pull blocks from Cmssy marketplace to local project")
  .argument("[package]", "Package slug to sync (e.g., @vendor/blocks.hero)")
  .option("--workspace <id>", "Workspace ID to sync from")
  .action(syncCommand);

// cmssy migrate
program
  .command("migrate [block-name]")
  .description("Migrate from package.json cmssy section to block.config.ts")
  .action(migrateCommand);

program.parse();
