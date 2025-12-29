import chalk from "chalk";
import fs from "fs-extra";
import inquirer from "inquirer";
import ora from "ora";
import path from "path";
import { hasConfig, loadConfig } from "../utils/config.js";
import { createClient } from "../utils/graphql.js";

interface SyncOptions {
  workspace?: string;
}

const INSTALLED_PACKAGES_QUERY = `
  query GetInstalledPackages($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      name
      installedPackages {
        id
        package {
          id
          slug
          displayName
          packageType
          currentVersion {
            version
            componentUrl
            cssUrl
            packageJsonUrl
            schemaFields
            defaultContent
          }
        }
      }
    }
  }
`;

export async function syncCommand(
  packageSlug: string | undefined,
  options: SyncOptions
) {
  console.log(chalk.blue.bold("\n🔨 Cmssy Forge - Sync Blocks\n"));

  // Check configuration
  if (!hasConfig()) {
    console.error(chalk.red("✖ Not configured. Run: cmssy-forge configure\n"));
    process.exit(1);
  }

  const config = loadConfig();

  // Check if we're in a blockforge project
  const configPath = path.join(process.cwd(), "blockforge.config.js");
  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red("✖ Not a blockforge project (missing blockforge.config.js)\n")
    );
    process.exit(1);
  }

  // Get workspace ID
  let workspaceId = options.workspace;
  if (!workspaceId) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "workspaceId",
        message: "Enter Workspace ID:",
        validate: (input) => {
          if (!input) {
            return "Workspace ID is required";
          }
          return true;
        },
      },
    ]);
    workspaceId = answer.workspaceId;
  }

  // Fetch installed packages
  const spinner = ora("Fetching installed packages...").start();
  const client = createClient();

  try {
    const result = await client.request(INSTALLED_PACKAGES_QUERY, {
      workspaceId,
    });

    spinner.succeed(chalk.green("Fetched installed packages"));

    const workspace = result.workspace;
    if (!workspace) {
      console.error(chalk.red("✖ Workspace not found\n"));
      process.exit(1);
    }

    const installedPackages = workspace.installedPackages || [];

    if (installedPackages.length === 0) {
      console.log(chalk.yellow("⚠ No packages installed in this workspace\n"));
      return;
    }

    // Filter by package slug if provided
    let packagesToSync = installedPackages;
    if (packageSlug) {
      packagesToSync = installedPackages.filter(
        (ip: any) => ip.package.slug === packageSlug
      );

      if (packagesToSync.length === 0) {
        console.error(
          chalk.red(`✖ Package "${packageSlug}" not found in workspace\n`)
        );
        process.exit(1);
      }
    }

    console.log(
      chalk.cyan(`\nFound ${packagesToSync.length} package(s) to sync:\n`)
    );
    packagesToSync.forEach((ip: any) => {
      console.log(
        chalk.white(
          `  • ${ip.package.slug} v${ip.package.currentVersion.version} (${ip.package.packageType})`
        )
      );
    });
    console.log("");

    // Sync each package
    let successCount = 0;
    let errorCount = 0;

    for (const installedPkg of packagesToSync) {
      const pkg = installedPkg.package;
      const pkgSpinner = ora(`Syncing ${pkg.slug}...`).start();

      try {
        await syncPackage(pkg);
        pkgSpinner.succeed(chalk.green(`${pkg.slug} synced`));
        successCount++;
      } catch (error: any) {
        pkgSpinner.fail(chalk.red(`${pkg.slug} failed`));
        console.error(chalk.red(`  Error: ${error.message}\n`));
        errorCount++;
      }
    }

    console.log("");
    if (errorCount === 0) {
      console.log(chalk.green.bold(`✓ ${successCount} package(s) synced\n`));
    } else {
      console.log(
        chalk.yellow(`⚠ ${successCount} succeeded, ${errorCount} failed\n`)
      );
    }
  } catch (error: any) {
    spinner.fail(chalk.red("Failed to fetch packages"));
    console.error(chalk.red(`  Error: ${error.message}\n`));
    process.exit(1);
  }
}

async function syncPackage(pkg: any): Promise<void> {
  const { slug, packageType, displayName, currentVersion } = pkg;

  // Determine target directory
  const targetDir =
    packageType === "block"
      ? path.join(process.cwd(), "blocks", getPackageName(slug))
      : path.join(process.cwd(), "templates", getPackageName(slug));

  // Create directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const srcDir = path.join(targetDir, "src");
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true });
  }

  // Download component JavaScript
  const componentCode = await downloadFile(currentVersion.componentUrl);
  fs.writeFileSync(path.join(srcDir, "index.tsx"), componentCode);

  // Download CSS if available
  if (currentVersion.cssUrl) {
    const cssCode = await downloadFile(currentVersion.cssUrl);
    fs.writeFileSync(path.join(srcDir, "index.css"), cssCode);
  }

  // Download and parse package.json
  let packageJsonData: any = {
    name: slug,
    version: currentVersion.version,
    description: displayName,
  };

  if (currentVersion.packageJsonUrl) {
    try {
      const packageJsonContent = await downloadFile(
        currentVersion.packageJsonUrl
      );
      packageJsonData = JSON.parse(packageJsonContent);
    } catch (error) {
      // If package.json fetch fails, use defaults
      console.warn(
        chalk.yellow(
          `  Warning: Could not fetch package.json for ${slug}, using defaults`
        )
      );
    }
  }

  // Add blockforge metadata
  packageJsonData.blockforge = {
    packageType,
    displayName,
    schemaFields: currentVersion.schemaFields || [],
    defaultContent: currentVersion.defaultContent || {},
  };

  // Write package.json
  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify(packageJsonData, null, 2)
  );

  // Create README.md
  const readme = `# ${displayName}

Synced from Cmssy marketplace.

Package: \`${slug}\`
Version: \`${currentVersion.version}\`

## Development

\`\`\`bash
# Build this ${packageType}
pnpm build:${packageType} ${targetDir}
\`\`\`
`;

  fs.writeFileSync(path.join(targetDir, "README.md"), readme);
}

async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  return response.text();
}

function getPackageName(slug: string): string {
  // Extract package name from slug
  // e.g., @cmssy/blocks.hero -> hero
  // e.g., @vendor/blocks.pricing -> pricing
  const parts = slug.split("/");
  const lastPart = parts[parts.length - 1];
  const nameParts = lastPart.split(".");
  return nameParts[nameParts.length - 1];
}
