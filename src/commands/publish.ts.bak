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

  // Show current versions
  console.log(chalk.cyan("Current versions:\n"));
  packages.forEach((pkg) => {
    console.log(
      chalk.white(`  ${pkg.packageJson.name}: ${chalk.bold(pkg.packageJson.version)}`)
    );
  });
  console.log("");

  // Version bumping - interactive or from flags
  let bumpType: "patch" | "minor" | "major" | null = null;

  if (options.patch || options.minor || options.major) {
    // Use flag-based bump
    bumpType = options.patch ? "patch" : options.minor ? "minor" : "major";
  } else {
    // Interactive prompt - show calculated versions for first package as example
    const examplePkg = packages[0];
    const currentVersion = examplePkg.packageJson.version;
    const patchVersion = semver.inc(currentVersion, "patch");
    const minorVersion = semver.inc(currentVersion, "minor");
    const majorVersion = semver.inc(currentVersion, "major");

    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "bumpType",
        message: "Select version bump:",
        choices: [
          {
            name: `Patch (${currentVersion} → ${patchVersion}) - Bug fixes`,
            value: "patch",
          },
          {
            name: `Minor (${currentVersion} → ${minorVersion}) - New features, backward compatible`,
            value: "minor",
          },
          {
            name: `Major (${currentVersion} → ${majorVersion}) - Breaking changes`,
            value: "major",
          },
          {
            name: "No version bump - publish current version",
            value: null,
          },
        ],
      },
    ]);

    bumpType = answer.bumpType;
  }

  // Apply version bump if selected
  if (bumpType) {
    console.log(chalk.cyan(`\nVersion bump: ${bumpType}\n`));

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
    chalk.cyan(`Publishing ${packages.length} package(s):\n`)
  );
  packages.forEach((pkg) => {
    console.log(
      chalk.white(`  • ${pkg.packageJson.name} ${chalk.bold("v" + pkg.packageJson.version)}`)
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

      // Extract detailed error information from GraphQL errors
      let errorMessage = error.message || "Unknown error";

      // graphql-request wraps errors in response.errors array
      if (error.response?.errors && error.response.errors.length > 0) {
        const graphqlError = error.response.errors[0];
        errorMessage = graphqlError.message;

        // Show error code if available (e.g., PLAN_LIMIT_EXCEEDED, VALIDATION_ERROR)
        if (graphqlError.extensions?.code) {
          errorMessage += chalk.gray(` [${graphqlError.extensions.code}]`);
        }

        // Show additional details for plan limit errors
        if (graphqlError.extensions?.resource) {
          console.error(chalk.yellow(`  Resource: ${graphqlError.extensions.resource}`));
          if (graphqlError.extensions.current !== undefined) {
            console.error(chalk.yellow(`  Current: ${graphqlError.extensions.current}/${graphqlError.extensions.limit}`));
          }
          if (graphqlError.extensions.plan) {
            console.error(chalk.yellow(`  Plan: ${graphqlError.extensions.plan}`));
          }
        }
      }

      console.error(chalk.red(`  ${errorMessage}\n`));
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

// Bundle source code with esbuild (combines all local imports into single file)
// Bundle source code with esbuild (combines all local imports into single file)
// UPDATED: Use CommonJS format to avoid ES module export statements
async function bundleSourceCode(packagePath: string): Promise<string> {
  const { build } = await import("esbuild");

  const srcDir = path.join(packagePath, "src");
  const tsxPath = path.join(srcDir, "index.tsx");
  const tsPath = path.join(srcDir, "index.ts");

  let entryPoint: string;
  if (fs.existsSync(tsxPath)) {
    entryPoint = tsxPath;
  } else if (fs.existsSync(tsPath)) {
    entryPoint = tsPath;
  } else {
    throw new Error(
      `Source code not found. Expected ${tsxPath} or ${tsPath}`
    );
  }

  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "cjs", // CommonJS format (module.exports) - compatible with SSR VM
    platform: "node", // Node platform for CommonJS
    jsx: "transform", // Transform JSX to React.createElement
    loader: { ".tsx": "tsx", ".ts": "ts", ".css": "empty" },
    external: [], // Bundle everything (React will be provided by SSR sandbox)
  });

  return result.outputFiles[0].text;
}

// Wrap bundled code with mount/update pattern for interactive blocks
function wrapWithInteractivePattern(bundledCode: string): string {
  return `
// Original component code
${bundledCode}

// Auto-generated interactive wrapper by CLI
import { createRoot } from 'react-dom/client';

const OriginalComponent = exports.default || module.exports.default;

if (!OriginalComponent) {
  throw new Error('Block must export a default component');
}

export default {
  mount(element, props) {
    const root = createRoot(element);
    root.render(React.createElement(OriginalComponent, { content: props }));
    return { root };
  },

  update(_element, props, ctx) {
    ctx.root.render(React.createElement(OriginalComponent, { content: props }));
  },

  unmount(_element, ctx) {
    ctx.root.unmount();
  }
};
`.trim();
}

// Compile CSS with optional Tailwind support
async function compileCss(packagePath: string, bundledSourceCode: string): Promise<string | undefined> {
  const srcDir = path.join(packagePath, "src");
  const cssPath = path.join(srcDir, "index.css");

  if (!fs.existsSync(cssPath)) {
    return undefined;
  }

  let cssContent = fs.readFileSync(cssPath, "utf-8");

  // If no Tailwind/PostCSS imports, return raw CSS
  if (!cssContent.includes("@import") && !cssContent.includes("@tailwind")) {
    return cssContent;
  }

  // Load PostCSS
  const { default: postcss } = await import("postcss");

  // Check for Tailwind v4 vs v3
  const projectRoot = process.cwd();
  const projectPackageJson = fs.readJsonSync(path.join(projectRoot, "package.json"));
  const hasTailwindV4 = !!(
    projectPackageJson.devDependencies?.["@tailwindcss/postcss"] ||
    projectPackageJson.dependencies?.["@tailwindcss/postcss"]
  );

  let tailwindPlugin: any;

  if (hasTailwindV4) {
    // Tailwind v4 with @tailwindcss/postcss
    const tailwindV4Path = path.join(
      projectRoot,
      "node_modules",
      "@tailwindcss/postcss",
      "dist",
      "index.mjs"
    );
    const tailwindV4Module = await import(tailwindV4Path);
    tailwindPlugin = tailwindV4Module.default || tailwindV4Module;
  } else {
    // Tailwind v3 - convert @import to @tailwind directives
    cssContent = cssContent.replace(
      /@import\s+["']tailwindcss["'];?/g,
      "@tailwind base;\n@tailwind components;\n@tailwind utilities;"
    );

    const tailwindcssPath = path.join(
      projectRoot,
      "node_modules",
      "tailwindcss",
      "lib",
      "index.js"
    );
    const tailwindcssModule = await import(tailwindcssPath);
    const tailwindcss = tailwindcssModule.default || tailwindcssModule;
    tailwindPlugin = tailwindcss({
      content: [{ raw: bundledSourceCode, extension: "tsx" }],
    });
  }

  // Process CSS
  const result = await postcss([tailwindPlugin]).process(cssContent, {
    from: cssPath,
  });

  return result.css;
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
  console.log("[DEBUG] publishToWorkspace START");
  const { packageJson, path: packagePath, blockConfig } = pkg;

  // Use blockConfig if available, fallback to package.json cmssy
  const metadata = blockConfig || packageJson.cmssy || {};

  // Generate block_type from package name
  // @cmssy/blocks.hero -> hero
  const blockType = packageJson.name
    .replace(/@[^/]+\//, "")
    .replace(/^blocks\./, "")
    .replace(/^templates\./, "");

  console.log("[DEBUG] Starting bundleSourceCode...");
  // Bundle source code (combines all local imports)
  let bundledSourceCode = await bundleSourceCode(packagePath);
  console.log("[DEBUG] bundleSourceCode DONE");

  // Wrap with interactive pattern if block is interactive
  const isInteractive = metadata.interactive || false;
  if (isInteractive) {
    console.log("[DEBUG] Wrapping with interactive mount/update pattern...");
    bundledSourceCode = wrapWithInteractivePattern(bundledSourceCode);
  } else {
    console.log("[DEBUG] Using direct export (SSR ready)");
  }

  console.log("[DEBUG] Starting compileCss...");
  // Compile CSS (with Tailwind if needed)
  const compiledCss = await compileCss(packagePath, bundledSourceCode);
  console.log("[DEBUG] compileCss DONE");

  // Convert block.config.ts schema to schemaFields if using blockConfig
  let schemaFields = metadata.schemaFields || [];
  if (blockConfig && blockConfig.schema) {
    schemaFields = convertSchemaToFields(blockConfig.schema);
  }

  // Build input with inline sourceCode and cssCode
  // Backend will handle uploading to Blob Storage
  const input = {
    blockType,
    name: metadata.displayName || metadata.name || packageJson.name,
    description: packageJson.description || metadata.description || "",
    icon: metadata.icon || "Blocks",
    category: metadata.category || "Custom",
    sourceCode: bundledSourceCode,
    cssCode: compiledCss,
    interactive: metadata.interactive || false,
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

  // Send mutation with timeout using Promise.race
  const TIMEOUT_MS = 180000; // 3 minutes

  console.log("[DEBUG] Creating timeout promise...");
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      console.log("[DEBUG] TIMEOUT FIRED!");
      reject(new Error(
        "Block upload timed out after 3 minutes. This may be due to:\n" +
        "  - Large file size (try reducing bundle size)\n" +
        "  - Slow network connection\n" +
        "  - Backend processing issues\n" +
        "Check backend logs for more details."
      ));
    }, TIMEOUT_MS);
  });

  console.log("[DEBUG] Sending GraphQL request to:", apiUrl);
  const requestPromise = client.request(IMPORT_BLOCK_MUTATION, { input });

  console.log("[DEBUG] Waiting for Promise.race...");
  const result = await Promise.race([requestPromise, timeoutPromise]);
  console.log("[DEBUG] Promise.race RESOLVED!");

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

    // Add defaultValue if present
    if (field.defaultValue !== undefined) {
      baseField.defaultValue = field.defaultValue;
    }

    // Add placeholder if present
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
