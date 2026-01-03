import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { loadBlockConfig, validateSchema } from "./block-config.js";
import { getPackageJson } from "./cmssy-config.js";

export interface ScanOptions {
  /** Throw errors instead of warnings (default: false) */
  strict?: boolean;
  /** Load block.config.ts (default: true) */
  loadConfig?: boolean;
  /** Validate schema (default: true) */
  validateSchema?: boolean;
  /** Load preview.json (default: false) */
  loadPreview?: boolean;
  /** Require package.json (default: true) */
  requirePackageJson?: boolean;
  /** Custom working directory (default: process.cwd()) */
  cwd?: string;
}

export interface ScannedResource {
  type: "block" | "template";
  name: string;
  path: string;
  displayName?: string;
  description?: string;
  category?: string;
  previewData?: any;
  blockConfig?: any;
  packageJson?: any;
}

/**
 * Scan blocks and templates directories with configurable options.
 * Supports 3 modes:
 * - Strict mode (build): throwuje błędy, wymaga block.config.ts + walidacja
 * - Lenient mode (dev): warny, ładuje preview.json, metadata
 * - Minimal mode (package): tylko package.json, bez walidacji
 */
export async function scanResources(
  options: ScanOptions = {}
): Promise<ScannedResource[]> {
  const {
    strict = false,
    loadConfig = true,
    validateSchema: shouldValidate = true,
    loadPreview = false,
    requirePackageJson = true,
    cwd = process.cwd(),
  } = options;

  const resources: ScannedResource[] = [];

  // Scan blocks
  await scanDirectory({
    type: "block",
    dir: path.join(cwd, "blocks"),
    resources,
    strict,
    loadConfig,
    shouldValidate,
    loadPreview,
    requirePackageJson,
  });

  // Scan templates
  await scanDirectory({
    type: "template",
    dir: path.join(cwd, "templates"),
    resources,
    strict,
    loadConfig,
    shouldValidate,
    loadPreview,
    requirePackageJson,
  });

  return resources;
}

interface ScanDirectoryOptions {
  type: "block" | "template";
  dir: string;
  resources: ScannedResource[];
  strict: boolean;
  loadConfig: boolean;
  shouldValidate: boolean;
  loadPreview: boolean;
  requirePackageJson: boolean;
}

async function scanDirectory(opts: ScanDirectoryOptions) {
  const { type, dir, resources, strict, loadConfig, shouldValidate, loadPreview, requirePackageJson } = opts;

  if (!fs.existsSync(dir)) {
    return;
  }

  const itemDirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const itemName of itemDirs) {
    const itemPath = path.join(dir, itemName);

    // Try loading block.config.ts if requested
    let blockConfig = null;
    if (loadConfig) {
      blockConfig = await loadBlockConfig(itemPath);

      if (!blockConfig) {
        // Check if package.json has cmssy (old format)
        const pkg = getPackageJson(itemPath);
        if (pkg && pkg.cmssy) {
          const message =
            `${type === "block" ? "Block" : "Template"} "${itemName}" uses legacy package.json format.\n` +
            `Please migrate to block.config.ts.\n` +
            `Run: cmssy migrate ${itemName}\n` +
            `Or see migration guide: https://cmssy.io/docs/migration`;

          if (strict) {
            throw new Error(message);
          } else {
            console.warn(chalk.yellow(`Warning: ${message}`));
          }
        }

        if (strict) {
          console.warn(
            chalk.yellow(
              `Warning: Skipping ${itemName} - no block.config.ts found`
            )
          );
        }
        continue;
      }

      // Validate schema if requested
      if (shouldValidate) {
        const validation = await validateSchema(blockConfig.schema, itemPath);
        if (!validation.valid) {
          const errorMessage = `\nValidation ${strict ? "errors" : "warnings"} in ${itemName}:`;

          if (strict) {
            console.error(chalk.red(errorMessage));
            validation.errors.forEach((err) =>
              console.error(chalk.red(`  - ${err}`))
            );
            throw new Error(`Schema validation failed for ${itemName}`);
          } else {
            console.warn(chalk.yellow(errorMessage));
            validation.errors.forEach((err) =>
              console.warn(chalk.yellow(`  - ${err}`))
            );
            continue;
          }
        }
      }
    }

    // Load package.json
    const pkg = getPackageJson(itemPath);
    if (requirePackageJson && (!pkg || !pkg.name || !pkg.version)) {
      const message = `${type === "block" ? "Block" : "Template"} "${itemName}" must have package.json with name and version`;

      if (strict) {
        throw new Error(message);
      } else {
        console.warn(chalk.yellow(`Warning: ${message}`));
        continue;
      }
    }

    // Load preview.json if requested
    let previewData = {};
    if (loadPreview) {
      const previewPath = path.join(itemPath, "preview.json");
      if (fs.existsSync(previewPath)) {
        previewData = fs.readJsonSync(previewPath);
      }
    }

    // Build resource object
    const resource: ScannedResource = {
      type,
      name: itemName,
      path: itemPath,
      packageJson: pkg,
    };

    // Add optional fields if block.config.ts was loaded
    if (blockConfig) {
      resource.blockConfig = blockConfig;
      resource.displayName = blockConfig.name || itemName;
      resource.description = blockConfig.description || pkg?.description;
      resource.category = blockConfig.category;
    }

    if (loadPreview && Object.keys(previewData).length > 0) {
      resource.previewData = previewData;
    }

    resources.push(resource);
  }
}
