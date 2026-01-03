import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import archiver from "archiver";
import { loadConfig } from "../utils/cmssy-config.js";
import { scanResources, ScannedResource } from "../utils/scanner.js";

interface PackageOptions {
  all?: boolean;
  output?: string;
}

interface Resource {
  name: string;
  type: "block" | "template";
  dir: string;
  packageJson: any;
}

export async function packageCommand(
  packageNames: string[] = [],
  options: PackageOptions
) {
  const cwd = process.cwd();

  // Load cmssy config
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error(
      chalk.red("✖ Not a Cmssy project (missing cmssy.config.js)")
    );
    process.exit(1);
  }

  // Scan for blocks and templates (minimal mode - no validation, just package.json)
  const scannedResources = await scanResources({
    strict: false,
    loadConfig: false,
    validateSchema: false,
    loadPreview: false,
    requirePackageJson: true,
    cwd,
  });

  if (scannedResources.length === 0) {
    console.log(chalk.yellow("⚠ No blocks or templates found"));
    return;
  }

  // Map ScannedResource to local Resource interface
  const resources = scannedResources.map((r) => ({
    name: r.name,
    type: r.type,
    dir: r.path, // ScannedResource uses 'path', local uses 'dir'
    packageJson: r.packageJson,
  }));

  // Determine which packages to package
  let toPackage = [];

  if (options.all) {
    toPackage = resources;
  } else if (packageNames.length > 0) {
    // Find specific packages
    for (const name of packageNames) {
      const resource = resources.find((r) => r.name === name);
      if (!resource) {
        console.error(chalk.red(`✖ Package not found: ${name}`));
        process.exit(1);
      }
      toPackage.push(resource);
    }
  } else {
    console.error(
      chalk.red("✖ Specify packages to package or use --all:\n") +
        chalk.white("  cmssy package hero\n") +
        chalk.white("  cmssy package hero pricing\n") +
        chalk.white("  cmssy package --all")
    );
    process.exit(1);
  }

  // Create output directory
  const outputDir = path.join(cwd, options.output || "packages");
  await fs.ensureDir(outputDir);

  console.log(chalk.blue(`\n📦 Packaging ${toPackage.length} package(s)...\n`));

  // Package each resource
  for (const resource of toPackage) {
    await packageResource(resource, outputDir);
  }

  console.log(
    chalk.green(
      `\n✓ Successfully packaged ${toPackage.length} package(s) to ${outputDir}`
    )
  );
}

async function packageResource(resource: Resource, outputDir: string) {
  const spinner = ora(
    `Packaging ${resource.type} ${chalk.cyan(resource.name)}`
  ).start();

  try {
    // Create output filename
    const version = resource.packageJson.version || "1.0.0";
    const outputFile = path.join(
      outputDir,
      `${resource.name}-${version}.zip`
    );

    // Create write stream
    const output = fs.createWriteStream(outputFile);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    // Listen for archive events
    output.on("close", () => {
      const size = (archive.pointer() / 1024).toFixed(2);
      spinner.succeed(
        `Packaged ${resource.type} ${chalk.cyan(resource.name)} (${size} KB)`
      );
    });

    archive.on("error", (err) => {
      throw err;
    });

    // Pipe archive to output file
    archive.pipe(output);

    // Add files to archive
    // 1. Source directory
    const srcDir = path.join(resource.dir, "src");
    if (await fs.pathExists(srcDir)) {
      archive.directory(srcDir, "src");
    }

    // 2. package.json
    const packageJsonPath = path.join(resource.dir, "package.json");
    if (await fs.pathExists(packageJsonPath)) {
      archive.file(packageJsonPath, { name: "package.json" });
    }

    // 3. block.config.ts (if exists)
    const blockConfigPath = path.join(resource.dir, "block.config.ts");
    if (await fs.pathExists(blockConfigPath)) {
      archive.file(blockConfigPath, { name: "block.config.ts" });
    }

    // 4. preview.json (if exists)
    const previewJsonPath = path.join(resource.dir, "preview.json");
    if (await fs.pathExists(previewJsonPath)) {
      archive.file(previewJsonPath, { name: "preview.json" });
    }

    // 5. README.md (if exists)
    const readmePath = path.join(resource.dir, "README.md");
    if (await fs.pathExists(readmePath)) {
      archive.file(readmePath, { name: "README.md" });
    }

    // 6. Built files from public/ (if exists)
    const publicDir = path.join(
      process.cwd(),
      "public",
      resource.packageJson.name,
      version
    );
    if (await fs.pathExists(publicDir)) {
      archive.directory(publicDir, "dist");
    }

    // Finalize archive
    await archive.finalize();

    // Wait for close event
    await new Promise<void>((resolve) => {
      output.on("close", () => resolve());
    });
  } catch (error: any) {
    spinner.fail(
      `Failed to package ${resource.type} ${chalk.cyan(resource.name)}: ${
        error.message
      }`
    );
    throw error;
  }
}
