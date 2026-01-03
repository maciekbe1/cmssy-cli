import chalk from "chalk";
import { build as esbuild } from "esbuild";
import { execSync } from "child_process";
import fs from "fs-extra";
import path from "path";
import { generatePackageJsonMetadata } from "./block-config.js";
import { generateTypes } from "./type-generator.js";

export interface BuildOptions {
  /** Framework (default: "react") */
  framework?: string;
  /** Enable minification (default: true for production, false for dev) */
  minify?: boolean;
  /** Enable sourcemaps (default: true) */
  sourcemap?: boolean;
  /** Output mode: "versioned" or "flat" (default: "versioned") */
  outputMode?: "versioned" | "flat";
  /** Generate package.json with cmssy metadata (default: true) */
  generatePackageJson?: boolean;
  /** Generate TypeScript types (default: true) */
  generateTypes?: boolean;
  /** Throw errors or warn (default: true for build, false for dev) */
  strict?: boolean;
}

export interface BuildableResource {
  type: "block" | "template";
  name: string;
  path: string;
  packageJson?: any;
  blockConfig?: any;
}

/**
 * Build a resource (block or template) with configurable options.
 * Supports 2 modes:
 * - Production mode (build): versioned output, minified, generates package.json
 * - Development mode (dev): flat output, not minified, no package.json
 */
export async function buildResource(
  resource: BuildableResource,
  outDir: string,
  options: BuildOptions = {}
): Promise<void> {
  const {
    framework = "react",
    minify = true,
    sourcemap = true,
    outputMode = "versioned",
    generatePackageJson = true,
    generateTypes: shouldGenerateTypes = true,
    strict = true,
  } = options;

  const srcPath = path.join(resource.path, "src");
  const entryPoint =
    framework === "react"
      ? path.join(srcPath, "index.tsx")
      : path.join(srcPath, "index.ts");

  // Check entry point exists
  if (!fs.existsSync(entryPoint)) {
    const message = `Entry point not found: ${entryPoint}`;
    if (strict) {
      throw new Error(message);
    } else {
      console.warn(chalk.yellow(`Warning: ${message}`));
      return;
    }
  }

  // Determine output paths based on mode
  let destDir: string;
  let outFile: string;
  let outCssFile: string | null = null;

  if (outputMode === "versioned") {
    // Production: public/@vendor/blocks.hero/1.0.0/
    if (!resource.packageJson || !resource.packageJson.name || !resource.packageJson.version) {
      const message = `Resource "${resource.name}" requires package.json with name and version for versioned output`;
      if (strict) {
        throw new Error(message);
      } else {
        console.warn(chalk.yellow(`Warning: ${message}`));
        return;
      }
    }

    const packageName = resource.packageJson.name;
    const version = resource.packageJson.version;
    destDir = path.join(outDir, packageName, version);
    outFile = path.join(destDir, "index.js");
    outCssFile = path.join(destDir, "index.css");

    fs.mkdirSync(destDir, { recursive: true });
  } else {
    // Development: .cmssy/dev/block.hero.js
    destDir = outDir;
    outFile = path.join(outDir, `${resource.type}.${resource.name}.js`);
    outCssFile = path.join(outDir, `${resource.type}.${resource.name}.css`);

    fs.mkdirSync(destDir, { recursive: true });
  }

  // Build JavaScript with esbuild
  try {
    await esbuild({
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      outfile: outFile,
      jsx: "transform",
      minify,
      sourcemap,
      target: "es2020",
      external: ["*.css"],
    });
  } catch (error) {
    const message = `Build error for ${resource.name}`;
    if (strict) {
      throw error;
    } else {
      console.error(chalk.red(`${message}:`), error);
      return;
    }
  }

  // Process CSS if exists
  const cssPath = path.join(srcPath, "index.css");
  if (fs.existsSync(cssPath) && outCssFile) {
    await processCSS(cssPath, outCssFile, minify, resource.name, strict);
  }

  // Generate package.json with cmssy metadata (production mode)
  if (generatePackageJson && outputMode === "versioned" && resource.blockConfig) {
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
  }

  // Generate TypeScript types
  if (shouldGenerateTypes && resource.blockConfig) {
    await generateTypes(resource.path, resource.blockConfig.schema);
  }
}

/**
 * Process CSS with PostCSS (if config exists) or copy as-is
 */
async function processCSS(
  cssPath: string,
  outCssFile: string,
  minify: boolean,
  resourceName: string,
  strict: boolean
): Promise<void> {
  const postcssConfigPath = path.join(process.cwd(), "postcss.config.js");

  if (fs.existsSync(postcssConfigPath)) {
    // Use PostCSS to process CSS (includes Tailwind)
    try {
      const minifyFlag = minify ? " --no-map" : "";
      execSync(`npx postcss "${cssPath}" -o "${outCssFile}"${minifyFlag}`, {
        stdio: "pipe",
        cwd: process.cwd(),
      });
    } catch (error: any) {
      const message = `PostCSS processing failed for ${resourceName}: ${error.message}`;
      if (strict) {
        console.warn(chalk.yellow(`Warning: ${message}`));
      } else {
        console.warn(chalk.yellow(`Warning: ${message}`));
      }
      console.log(chalk.gray("Copying CSS as-is..."));
      fs.copyFileSync(cssPath, outCssFile);
    }
  } else {
    // No PostCSS config - just copy CSS
    fs.copyFileSync(cssPath, outCssFile);
  }
}
