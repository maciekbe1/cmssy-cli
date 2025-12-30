import chalk from "chalk";
import { build as esbuild } from "esbuild";
import { execSync } from "child_process";
import fs from "fs-extra";
import ora from "ora";
import path from "path";
import { getPackageJson, loadConfig } from "../utils/cmssy-config.js";
import {
  loadBlockConfig,
  validateSchema,
  generatePackageJsonMetadata,
} from "../utils/block-config.js";
import { generateTypes } from "../utils/type-generator.js";
import { ResourceConfig } from "../types/block-config.js";

interface BuildOptions {
  framework?: string;
}

interface Resource {
  type: "block" | "template";
  name: string;
  path: string;
  packageJson: any;
  blockConfig?: ResourceConfig;
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

      // Try loading block.config.ts
      const blockConfig = await loadBlockConfig(blockPath);

      if (!blockConfig) {
        // Check if package.json has cmssy (old format)
        const pkg = getPackageJson(blockPath);
        if (pkg && pkg.cmssy) {
          throw new Error(
            `Block "${blockName}" uses legacy package.json format.\n` +
              `Please migrate to block.config.ts.\n` +
              `Run: cmssy migrate ${blockName}\n` +
              `Or see migration guide: https://cmssy.io/docs/migration`
          );
        }

        console.warn(
          chalk.yellow(
            `Warning: Skipping ${blockName} - no block.config.ts found`
          )
        );
        continue;
      }

      // Validate schema
      const validation = await validateSchema(blockConfig.schema, blockPath);
      if (!validation.valid) {
        console.error(chalk.red(`\nValidation errors in ${blockName}:`));
        validation.errors.forEach((err) => console.error(chalk.red(`  - ${err}`)));
        throw new Error(`Schema validation failed for ${blockName}`);
      }

      // Load package.json for name and version
      const pkg = getPackageJson(blockPath);
      if (!pkg || !pkg.name || !pkg.version) {
        throw new Error(
          `Block "${blockName}" must have package.json with name and version`
        );
      }

      resources.push({
        type: "block",
        name: blockName,
        path: blockPath,
        packageJson: pkg,
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
      const templatePath = path.join(templatesDir, templateName);

      // Try loading block.config.ts
      const blockConfig = await loadBlockConfig(templatePath);

      if (!blockConfig) {
        // Check if package.json has cmssy (old format)
        const pkg = getPackageJson(templatePath);
        if (pkg && pkg.cmssy) {
          throw new Error(
            `Template "${templateName}" uses legacy package.json format.\n` +
              `Please migrate to block.config.ts.\n` +
              `Run: cmssy migrate ${templateName}\n` +
              `Or see migration guide: https://cmssy.io/docs/migration`
          );
        }

        console.warn(
          chalk.yellow(
            `Warning: Skipping ${templateName} - no block.config.ts found`
          )
        );
        continue;
      }

      // Validate schema
      const validation = await validateSchema(blockConfig.schema, templatePath);
      if (!validation.valid) {
        console.error(chalk.red(`\nValidation errors in ${templateName}:`));
        validation.errors.forEach((err) => console.error(chalk.red(`  - ${err}`)));
        throw new Error(`Schema validation failed for ${templateName}`);
      }

      // Load package.json for name and version
      const pkg = getPackageJson(templatePath);
      if (!pkg || !pkg.name || !pkg.version) {
        throw new Error(
          `Template "${templateName}" must have package.json with name and version`
        );
      }

      resources.push({
        type: "template",
        name: templateName,
        path: templatePath,
        packageJson: pkg,
        blockConfig,
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
    external: ["*.css"],
  });

  // Process CSS with PostCSS if exists
  const cssPath = path.join(srcPath, "index.css");
  if (fs.existsSync(cssPath)) {
    const outCssFile = path.join(destDir, "index.css");

    // Check if postcss.config.js exists (Tailwind enabled)
    const postcssConfigPath = path.join(process.cwd(), "postcss.config.js");

    if (fs.existsSync(postcssConfigPath)) {
      // Use PostCSS to process CSS (includes Tailwind)
      try {
        execSync(
          `npx postcss "${cssPath}" -o "${outCssFile}"${config.build?.minify ? " --no-map" : ""}`,
          { stdio: "pipe", cwd: process.cwd() }
        );
      } catch (error: any) {
        console.warn(chalk.yellow(`Warning: PostCSS processing failed: ${error.message}`));
        console.log(chalk.gray("Copying CSS as-is..."));
        fs.copyFileSync(cssPath, outCssFile);
      }
    } else {
      // No PostCSS config - just copy CSS
      fs.copyFileSync(cssPath, outCssFile);
    }
  }

  // Generate package.json with cmssy metadata from block.config.ts
  if (resource.blockConfig) {
    const cmssyMetadata = generatePackageJsonMetadata(
      resource.blockConfig,
      resource.type
    );

    const outputPackageJson = {
      ...resource.packageJson,
      cmssy: cmssyMetadata,
    };

    fs.writeFileSync(
      path.join(destDir, "package.json"),
      JSON.stringify(outputPackageJson, null, 2) + "\n"
    );

    // Generate TypeScript types
    await generateTypes(resource.path, resource.blockConfig.schema);
  } else {
    // Fallback: copy package.json as-is (shouldn't happen after migration)
    fs.copyFileSync(
      path.join(resource.path, "package.json"),
      path.join(destDir, "package.json")
    );
  }
}
