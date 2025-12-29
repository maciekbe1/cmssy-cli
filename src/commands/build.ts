import chalk from "chalk";
import { build as esbuild } from "esbuild";
import fs from "fs-extra";
import ora from "ora";
import path from "path";
import { getPackageJson, loadConfig } from "../utils/blockforge-config.js";

interface BuildOptions {
  framework?: string;
}

interface Resource {
  type: "block" | "template";
  name: string;
  path: string;
  packageJson: any;
}

export async function buildCommand(options: BuildOptions) {
  const spinner = ora("Starting build...").start();

  try {
    const config = await loadConfig();
    const framework = options.framework || config.framework;

    // Scan for blocks and templates
    const resources = await scanResources();

    if (resources.length === 0) {
      spinner.warn("No blocks or templates found");
      process.exit(0);
    }

    spinner.text = `Building ${resources.length} resources...`;

    const outDir = path.join(process.cwd(), config.build?.outDir || "public");

    // Clean output directory
    if (fs.existsSync(outDir)) {
      fs.removeSync(outDir);
    }
    fs.mkdirSync(outDir, { recursive: true });

    let successCount = 0;
    let errorCount = 0;

    for (const resource of resources) {
      try {
        await buildResource(resource, framework, outDir, config);
        successCount++;
        console.log(
          chalk.green(
            `  ✓ ${resource.packageJson.name}@${resource.packageJson.version}`
          )
        );
      } catch (error) {
        errorCount++;
        console.error(chalk.red(`  ✖ ${resource.name}:`), error);
      }
    }

    if (errorCount === 0) {
      spinner.succeed(`Build complete! ${successCount} resources built`);
      console.log(chalk.cyan(`\nOutput directory: ${outDir}\n`));
    } else {
      spinner.warn(
        `Build completed with errors: ${successCount} succeeded, ${errorCount} failed`
      );
    }
  } catch (error) {
    spinner.fail("Build failed");
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

async function scanResources(): Promise<Resource[]> {
  const resources: Resource[] = [];

  // Scan blocks
  const blocksDir = path.join(process.cwd(), "blocks");
  if (fs.existsSync(blocksDir)) {
    const blockDirs = fs
      .readdirSync(blocksDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const blockName of blockDirs) {
      const blockPath = path.join(blocksDir, blockName);
      const pkg = getPackageJson(blockPath);

      if (!pkg || !pkg.blockforge) {
        console.warn(
          chalk.yellow(
            `Warning: Skipping ${blockName} - no blockforge metadata`
          )
        );
        continue;
      }

      resources.push({
        type: "block",
        name: blockName,
        path: blockPath,
        packageJson: pkg,
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
      const templatePath = path.join(templatesDir, templateName);
      const pkg = getPackageJson(templatePath);

      if (!pkg || !pkg.blockforge) {
        console.warn(
          chalk.yellow(
            `Warning: Skipping ${templateName} - no blockforge metadata`
          )
        );
        continue;
      }

      resources.push({
        type: "template",
        name: templateName,
        path: templatePath,
        packageJson: pkg,
      });
    }
  }

  return resources;
}

async function buildResource(
  resource: Resource,
  framework: string,
  outDir: string,
  config: any
) {
  const srcPath = path.join(resource.path, "src");
  const entryPoint =
    framework === "react"
      ? path.join(srcPath, "index.tsx")
      : path.join(srcPath, "index.ts");

  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Entry point not found: ${entryPoint}`);
  }

  // Create versioned output directory
  // Example: public/@vendor/blocks.hero/1.0.0/
  const packageName = resource.packageJson.name;
  const version = resource.packageJson.version;
  const destDir = path.join(outDir, packageName, version);

  fs.mkdirSync(destDir, { recursive: true });

  // Build JavaScript
  const outFile = path.join(destDir, "index.js");

  await esbuild({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    outfile: outFile,
    jsx: "transform",
    minify: config.build?.minify ?? true,
    sourcemap: config.build?.sourcemap ?? true,
    target: "es2020",
    external: [],
  });

  // Copy CSS if exists
  const cssPath = path.join(srcPath, "index.css");
  if (fs.existsSync(cssPath)) {
    const outCssFile = path.join(destDir, "index.css");
    fs.copyFileSync(cssPath, outCssFile);
  }

  // Copy package.json for metadata
  fs.copyFileSync(
    path.join(resource.path, "package.json"),
    path.join(destDir, "package.json")
  );
}
