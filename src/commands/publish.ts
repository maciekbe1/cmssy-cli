import chalk from "chalk";
import fs from "fs-extra";
import { GraphQLClient } from "graphql-request";
import inquirer from "inquirer";
import ora from "ora";
import path from "path";
import semver from "semver";
import { hasConfig, loadConfig } from "../utils/config.js";
import {
  PUBLISH_PACKAGE_MUTATION,
  IMPORT_BLOCK_MUTATION,
} from "../utils/graphql.js";
import {
  loadBlockConfig,
  validateSchema,
} from "../utils/block-config.js";

interface PublishOptions {
  marketplace?: boolean;
  workspace?: string;
  patch?: boolean;
  minor?: boolean;
  major?: boolean;
  dryRun?: boolean;
  all?: boolean;
}

interface PackageInfo {
  type: "block" | "template";
  name: string;
  path: string;
  packageJson: any;
  blockConfig?: any;
}

export async function publishCommand(
  packageNames: string[] = [],
  options: PublishOptions
) {
  console.log(chalk.blue.bold("\n📦 Cmssy - Publish\n"));

  // Validate flags: must have either --marketplace or --workspace
  if (!options.marketplace && !options.workspace) {
    console.error(
      chalk.red("✖ Specify publish target:\n") +
        chalk.white("  --marketplace          Publish to public marketplace (requires review)\n") +
        chalk.white("  --workspace <id>       Publish to private workspace (no review)\n")
    );
    process.exit(1);
  }

  if (options.marketplace && options.workspace) {
    console.error(
      chalk.red("✖ Cannot specify both --marketplace and --workspace\n")
    );
    process.exit(1);
  }

  // Check configuration
  if (!hasConfig()) {
    console.error(chalk.red("✖ Not configured. Run: cmssy configure\n"));
    process.exit(1);
  }

  const config = loadConfig();

  // Get workspace ID if --workspace without value
  let workspaceId = options.workspace;
  if (typeof options.workspace === "boolean" || options.workspace === "") {
    // Flag provided without value, check .env
    if (config.workspaceId) {
      workspaceId = config.workspaceId;
      console.log(
        chalk.gray(`Using workspace ID from .env: ${workspaceId}\n`)
      );
    } else {
      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "workspaceId",
          message: "Enter Workspace ID:",
          validate: (input) => {
            if (!input) {
              return "Workspace ID is required (or set CMSSY_WORKSPACE_ID in .env)";
            }
            return true;
          },
        },
      ]);
      workspaceId = answer.workspaceId;
    }
  }

  // Find cmssy.config.js
  const configPath = path.join(process.cwd(), "cmssy.config.js");
  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red("✖ Not a cmssy project (missing cmssy.config.js)\n")
    );
    process.exit(1);
  }

  // Scan for packages to publish
  const packages = await scanPackages(packageNames, options);

  if (packages.length === 0) {
    console.log(chalk.yellow("⚠ No packages found to publish\n"));
    if (packageNames.length > 0) {
      console.log(chalk.gray("Packages specified:"));
      packageNames.forEach((name) => console.log(chalk.gray(`  • ${name}`)));
    }
    return;
  }

  // Version bumping
  if (options.patch || options.minor || options.major) {
    const bumpType = options.patch
      ? "patch"
      : options.minor
      ? "minor"
      : "major";
    console.log(chalk.cyan(`Version bump: ${bumpType}\n`));

    for (const pkg of packages) {
      const oldVersion = pkg.packageJson.version;
      const newVersion = semver.inc(oldVersion, bumpType);

      if (!newVersion) {
        console.error(
          chalk.red(`✖ Invalid version for ${pkg.name}: ${oldVersion}\n`)
        );
        continue;
      }

      pkg.packageJson.version = newVersion;

      // Update package.json
      const pkgPath = path.join(pkg.path, "package.json");
      fs.writeJsonSync(pkgPath, pkg.packageJson, { spaces: 2 });

      console.log(
        chalk.gray(`  ${pkg.name}: ${oldVersion} → ${newVersion}`)
      );
    }
    console.log("");
  }

  console.log(
    chalk.cyan(`Found ${packages.length} package(s) to publish:\n`)
  );
  packages.forEach((pkg) => {
    console.log(
      chalk.white(`  • ${pkg.packageJson.name} v${pkg.packageJson.version}`)
    );
  });
  console.log("");

  if (options.dryRun) {
    console.log(chalk.yellow("🔍 Dry run mode - nothing will be published\n"));
    return;
  }

  // Show target info
  if (options.marketplace) {
    console.log(
      chalk.yellow(
        "📋 Target: Marketplace (public)\n" +
          "   Status: Pending review\n" +
          "   You'll be notified when approved.\n"
      )
    );
  } else {
    console.log(
      chalk.cyan(
        `🏢 Target: Workspace (${workspaceId})\n` +
          "   Status: Published immediately (no review)\n"
      )
    );
  }

  // Publish each package
  let successCount = 0;
  let errorCount = 0;

  for (const pkg of packages) {
    const target = options.marketplace ? "marketplace" : "workspace";
    const spinner = ora(`Publishing ${pkg.packageJson.name} to ${target}...`).start();

    try {
      if (options.marketplace) {
        await publishToMarketplace(pkg, config.apiToken!, config.apiUrl);
        spinner.succeed(
          chalk.green(
            `${pkg.packageJson.name} submitted for review (pending)`
          )
        );
      } else {
        await publishToWorkspace(
          pkg,
          workspaceId as string,
          config.apiToken!,
          config.apiUrl
        );
        spinner.succeed(
          chalk.green(`${pkg.packageJson.name} published to workspace`)
        );
      }
      successCount++;
    } catch (error: any) {
      spinner.fail(chalk.red(`${pkg.packageJson.name} failed`));
      console.error(chalk.red(`  Error: ${error.message}\n`));
      errorCount++;
    }
  }

  console.log("");
  if (errorCount === 0) {
    console.log(
      chalk.green.bold(`✓ ${successCount} package(s) published successfully\n`)
    );
  } else {
    console.log(
      chalk.yellow(`⚠ ${successCount} succeeded, ${errorCount} failed\n`)
    );
  }
}

async function scanPackages(
  packageNames: string[],
  options: PublishOptions
): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  // Scan blocks
  const blocksDir = path.join(process.cwd(), "blocks");
  if (fs.existsSync(blocksDir)) {
    const blockDirs = fs
      .readdirSync(blocksDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const blockName of blockDirs) {
      // Filter: --all OR packageNames includes this block
      if (!options.all && !packageNames.includes(blockName)) {
        continue;
      }

      const blockPath = path.join(blocksDir, blockName);
      const pkgPath = path.join(blockPath, "package.json");

      if (!fs.existsSync(pkgPath)) {
        console.warn(
          chalk.yellow(`Warning: ${blockName} has no package.json, skipping`)
        );
        continue;
      }

      const packageJson = fs.readJsonSync(pkgPath);

      // Try loading block.config.ts
      const blockConfig = await loadBlockConfig(blockPath);

      if (!blockConfig && !packageJson.cmssy) {
        console.warn(
          chalk.yellow(
            `Warning: ${blockName} has no block.config.ts or package.json cmssy section, skipping`
          )
        );
        continue;
      }

      packages.push({
        type: "block",
        name: blockName,
        path: blockPath,
        packageJson,
        blockConfig,
      });
    }
  }

  // Scan templates
  const templatesDir = path.join(process.cwd(), "templates");
  if (fs.existsSync(templatesDir)) {
    const templateDirs = fs
      .readdirSync(templatesDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const templateName of templateDirs) {
      // Filter: --all OR packageNames includes this template
      if (!options.all && !packageNames.includes(templateName)) {
        continue;
      }

      const templatePath = path.join(templatesDir, templateName);
      const pkgPath = path.join(templatePath, "package.json");

      if (!fs.existsSync(pkgPath)) {
        console.warn(
          chalk.yellow(`Warning: ${templateName} has no package.json, skipping`)
        );
        continue;
      }

      const packageJson = fs.readJsonSync(pkgPath);

      // Try loading block.config.ts
      const blockConfig = await loadBlockConfig(templatePath);

      if (!blockConfig && !packageJson.cmssy) {
        console.warn(
          chalk.yellow(
            `Warning: ${templateName} has no block.config.ts or package.json cmssy section, skipping`
          )
        );
        continue;
      }

      packages.push({
        type: "template",
        name: templateName,
        path: templatePath,
        packageJson,
        blockConfig,
      });
    }
  }

  return packages;
}

async function publishToMarketplace(
  pkg: PackageInfo,
  apiToken: string,
  apiUrl: string
): Promise<void> {
  const { packageJson, path: packagePath, blockConfig } = pkg;

  // Use blockConfig if available, fallback to package.json cmssy
  const metadata = blockConfig || packageJson.cmssy || {};

  // Validate vendor info
  if (!metadata.vendorName && !packageJson.author) {
    throw new Error(
      "Vendor name required. Add 'vendorName' to block.config.ts or 'author' to package.json"
    );
  }

  const vendorName =
    metadata.vendorName ||
    (typeof packageJson.author === "string"
      ? packageJson.author
      : packageJson.author?.name);

  // Read source code from src/index.tsx or src/index.ts
  const srcDir = path.join(packagePath, "src");
  let sourceCode: string | undefined;

  const tsxPath = path.join(srcDir, "index.tsx");
  const tsPath = path.join(srcDir, "index.ts");

  if (fs.existsSync(tsxPath)) {
    sourceCode = fs.readFileSync(tsxPath, "utf-8");
  } else if (fs.existsSync(tsPath)) {
    sourceCode = fs.readFileSync(tsPath, "utf-8");
  } else {
    throw new Error(
      `Source code not found. Expected ${tsxPath} or ${tsPath}`
    );
  }

  // Read CSS if exists
  const cssPath = path.join(srcDir, "index.css");
  let cssCode: string | undefined;
  if (fs.existsSync(cssPath)) {
    cssCode = fs.readFileSync(cssPath, "utf-8");
  }

  // Convert block.config.ts schema to schemaFields if using blockConfig
  let schemaFields = metadata.schemaFields || [];
  if (blockConfig && blockConfig.schema) {
    schemaFields = convertSchemaToFields(blockConfig.schema);
  }

  // Build input
  const input = {
    name: packageJson.name,
    version: packageJson.version,
    displayName: metadata.displayName || metadata.name || packageJson.name,
    description: packageJson.description || metadata.description || "",
    longDescription: metadata.longDescription || null,
    packageType: pkg.type,
    category: metadata.category || "other",
    tags: metadata.tags || [],
    sourceCode,
    cssUrl: null,
    packageJsonUrl: "",
    schemaFields,
    defaultContent: extractDefaultContent(blockConfig?.schema || {}),
    vendorName,
    vendorEmail: packageJson.author?.email || null,
    vendorUrl: packageJson.homepage || packageJson.repository?.url || null,
    licenseType: metadata.pricing?.licenseType || metadata.licenseType || "free",
    priceCents: metadata.pricing?.priceCents || metadata.priceCents || 0,
  };

  // Create client
  const client = new GraphQLClient(apiUrl, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  // Send mutation
  const result = await client.request(PUBLISH_PACKAGE_MUTATION, {
    token: apiToken,
    input,
  });

  if (!result.publishPackage?.success) {
    throw new Error(
      result.publishPackage?.message || "Failed to publish package"
    );
  }
}

async function publishToWorkspace(
  pkg: PackageInfo,
  workspaceId: string,
  apiToken: string,
  apiUrl: string
): Promise<void> {
  const { packageJson, path: packagePath, blockConfig } = pkg;

  // Use blockConfig if available, fallback to package.json cmssy
  const metadata = blockConfig || packageJson.cmssy || {};

  // Read source code from src/index.tsx or src/index.ts
  const srcDir = path.join(packagePath, "src");
  let sourceCode: string | undefined;

  const tsxPath = path.join(srcDir, "index.tsx");
  const tsPath = path.join(srcDir, "index.ts");

  if (fs.existsSync(tsxPath)) {
    sourceCode = fs.readFileSync(tsxPath, "utf-8");
  } else if (fs.existsSync(tsPath)) {
    sourceCode = fs.readFileSync(tsPath, "utf-8");
  } else {
    throw new Error(
      `Source code not found. Expected ${tsxPath} or ${tsPath}`
    );
  }

  // Read CSS if exists
  const cssPath = path.join(srcDir, "index.css");
  let cssCode: string | undefined;
  if (fs.existsSync(cssPath)) {
    cssCode = fs.readFileSync(cssPath, "utf-8");
  }

  // Generate block_type from package name
  // @cmssy/blocks.hero -> hero
  const blockType = packageJson.name
    .replace(/@[^/]+\//, "")
    .replace(/^blocks\./, "")
    .replace(/^templates\./, "");

  // Convert block.config.ts schema to schemaFields if using blockConfig
  let schemaFields = metadata.schemaFields || [];
  if (blockConfig && blockConfig.schema) {
    schemaFields = convertSchemaToFields(blockConfig.schema);
  }

  // Build input
  const input = {
    blockType,
    name: metadata.displayName || metadata.name || packageJson.name,
    description: packageJson.description || metadata.description || "",
    icon: metadata.icon || "Blocks",
    category: metadata.category || "Custom",
    sourceCode,
    schemaFields,
    defaultContent: extractDefaultContent(blockConfig?.schema || {}),
    sourceRegistry: "local",
    sourceItem: packageJson.name,
    version: packageJson.version || "1.0.0",
  };

  // Create client with workspace header
  const client = new GraphQLClient(apiUrl, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
      "X-Workspace-ID": workspaceId,
    },
  });

  // Send mutation
  const result = await client.request(IMPORT_BLOCK_MUTATION, {
    input,
  });

  if (!result.importBlock) {
    throw new Error("Failed to import block to workspace");
  }
}

// Helper: Convert block.config.ts schema to schemaFields array
function convertSchemaToFields(schema: Record<string, any>): any[] {
  const fields: any[] = [];

  Object.entries(schema).forEach(([key, field]: [string, any]) => {
    const baseField: any = {
      key,
      type: field.type,
      label: field.label,
      required: field.required || false,
    };

    if (field.placeholder) {
      baseField.placeholder = field.placeholder;
    }

    if (field.type === "select" && field.options) {
      baseField.options = field.options;
    }

    if (field.type === "repeater" && field.schema) {
      baseField.minItems = field.minItems;
      baseField.maxItems = field.maxItems;
      baseField.itemSchema = {
        type: "object",
        fields: convertSchemaToFields(field.schema),
      };
    }

    fields.push(baseField);
  });

  return fields;
}

// Helper: Extract default content from schema
function extractDefaultContent(schema: Record<string, any>): any {
  const content: any = {};

  Object.entries(schema).forEach(([key, field]: [string, any]) => {
    if (field.defaultValue !== undefined) {
      content[key] = field.defaultValue;
    } else if (field.type === "repeater") {
      content[key] = [];
    }
  });

  return content;
}
