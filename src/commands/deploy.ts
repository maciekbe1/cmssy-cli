import chalk from "chalk";
import FormData from "form-data";
import fs from "fs-extra";
import fetch from "node-fetch";
import ora from "ora";
import path from "path";
import { hasConfig, loadConfig } from "../utils/config.js";
import { createClient, PUBLISH_PACKAGE_MUTATION } from "../utils/graphql.js";

interface DeployOptions {
  all?: boolean;
  blocks?: string[];
  templates?: string[];
  dryRun?: boolean;
}

interface PackageInfo {
  type: "block" | "template";
  name: string;
  path: string;
  packageJson: any;
}

export async function deployCommand(options: DeployOptions) {
  console.log(chalk.blue.bold("\n🔨 Cmssy Forge - Deploy to Marketplace\n"));

  // Check configuration
  if (!hasConfig()) {
    console.error(chalk.red("✖ Not configured. Run: cmssy-forge configure\n"));
    process.exit(1);
  }

  const config = loadConfig();

  // Find blockforge.config.js
  const configPath = path.join(process.cwd(), "blockforge.config.js");
  if (!fs.existsSync(configPath)) {
    console.error(
      chalk.red("✖ Not a blockforge project (missing blockforge.config.js)\n")
    );
    process.exit(1);
  }

  // Scan for packages to deploy
  const packages = await scanPackages(options);

  if (packages.length === 0) {
    console.log(chalk.yellow("⚠ No packages found to deploy\n"));
    return;
  }

  console.log(chalk.cyan(`Found ${packages.length} package(s) to deploy:\n`));
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

  // Deploy each package
  const client = createClient();
  let successCount = 0;
  let errorCount = 0;

  for (const pkg of packages) {
    const spinner = ora(
      `Uploading ${pkg.packageJson.name} to Cmssy...`
    ).start();

    try {
      await deployPackage(client, pkg, config.apiToken!, config.apiUrl);
      spinner.succeed(
        chalk.green(`${pkg.packageJson.name} submitted for review`)
      );
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
      chalk.green.bold(`✓ ${successCount} package(s) submitted for review\n`)
    );
    console.log(chalk.cyan("Your packages are pending Cmssy review."));
    console.log(chalk.cyan("You'll be notified when they're approved.\n"));
  } else {
    console.log(
      chalk.yellow(`⚠ ${successCount} succeeded, ${errorCount} failed\n`)
    );
  }
}

async function scanPackages(options: DeployOptions): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  // Scan blocks
  const blocksDir = path.join(process.cwd(), "blocks");
  if (fs.existsSync(blocksDir)) {
    const blockDirs = fs
      .readdirSync(blocksDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const blockName of blockDirs) {
      // Filter by options
      if (options.blocks && !options.blocks.includes(blockName)) {
        continue;
      }
      if (!options.all && !options.blocks) {
        continue; // Skip unless --all or specifically listed
      }

      const blockPath = path.join(blocksDir, blockName);
      const pkgPath = path.join(blockPath, "package.json");

      if (!fs.existsSync(pkgPath)) continue;

      const packageJson = fs.readJsonSync(pkgPath);
      if (!packageJson.blockforge) continue;

      packages.push({
        type: "block",
        name: blockName,
        path: blockPath,
        packageJson,
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
      // Filter by options
      if (options.templates && !options.templates.includes(templateName)) {
        continue;
      }
      if (!options.all && !options.templates) {
        continue;
      }

      const templatePath = path.join(templatesDir, templateName);
      const pkgPath = path.join(templatePath, "package.json");

      if (!fs.existsSync(pkgPath)) continue;

      const packageJson = fs.readJsonSync(pkgPath);
      if (!packageJson.blockforge) continue;

      packages.push({
        type: "template",
        name: templateName,
        path: templatePath,
        packageJson,
      });
    }
  }

  return packages;
}

interface UploadedUrls {
  componentUrl: string;
  cssUrl: string | null;
  packageJsonUrl: string;
}

interface UploadResponse {
  componentUrl: string;
  cssUrl?: string;
  packageJsonUrl: string;
}

async function uploadFilesToBackend(
  packagePublicPath: string,
  packageName: string,
  version: string,
  apiUrl: string,
  apiToken: string
): Promise<UploadedUrls> {
  const form = new FormData();

  // Add package metadata
  form.append("packageName", packageName);
  form.append("version", version);

  // Add index.js file
  const indexJsPath = path.join(packagePublicPath, "index.js");
  if (!fs.existsSync(indexJsPath)) {
    throw new Error(`index.js not found at ${indexJsPath}`);
  }
  form.append("component", fs.createReadStream(indexJsPath), {
    filename: "index.js",
    contentType: "application/javascript",
  });

  // Add index.css if exists
  const indexCssPath = path.join(packagePublicPath, "index.css");
  if (fs.existsSync(indexCssPath)) {
    form.append("css", fs.createReadStream(indexCssPath), {
      filename: "index.css",
      contentType: "text/css",
    });
  }

  // Add package.json
  const packageJsonPath = path.join(packagePublicPath, "package.json");
  let pkgJsonToUpload = packageJsonPath;

  if (!fs.existsSync(packageJsonPath)) {
    // If package.json doesn't exist in build output, use source
    pkgJsonToUpload = path.join(
      path.dirname(path.dirname(packagePublicPath)),
      "package.json"
    );
  }

  form.append("packageJson", fs.createReadStream(pkgJsonToUpload), {
    filename: "package.json",
    contentType: "application/json",
  });

  // Determine API base URL (remove /graphql suffix if present)
  const apiBase = apiUrl.replace("/graphql", "");
  const uploadUrl = `${apiBase}/api/upload-package`;

  // Upload to backend
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.statusText}. ${errorText}`);
  }

  const result = (await response.json()) as UploadResponse;

  return {
    componentUrl: result.componentUrl,
    cssUrl: result.cssUrl || null,
    packageJsonUrl: result.packageJsonUrl,
  };
}

async function deployPackage(
  client: any,
  pkg: PackageInfo,
  apiToken: string,
  apiUrl: string
): Promise<void> {
  const { packageJson } = pkg;
  const metadata = packageJson.blockforge;

  // Find built files in public/ directory
  const publicDir = path.join(process.cwd(), "public");
  const packagePublicPath = path.join(
    publicDir,
    packageJson.name,
    packageJson.version
  );

  if (!fs.existsSync(packagePublicPath)) {
    throw new Error(
      `Build output not found at ${packagePublicPath}. Run: blockforge build`
    );
  }

  // Upload package files to Cmssy backend, which uploads to Vercel Blob
  const { componentUrl, cssUrl, packageJsonUrl } = await uploadFilesToBackend(
    packagePublicPath,
    packageJson.name,
    packageJson.version,
    apiUrl,
    apiToken
  );

  // Build input
  const input = {
    name: packageJson.name,
    version: packageJson.version,
    displayName: metadata.displayName,
    description: packageJson.description || metadata.description || "",
    longDescription: metadata.longDescription || packageJson.description || "",
    packageType: metadata.packageType || pkg.type,
    category: metadata.category || "other",
    tags: metadata.tags || [],
    componentUrl,
    cssUrl,
    packageJsonUrl,
    schemaFields: metadata.schemaFields || null,
    defaultContent: metadata.defaultContent || null,
    vendorName: packageJson.author?.name || packageJson.author || "Unknown",
    vendorEmail: packageJson.author?.email || null,
    vendorUrl: packageJson.author?.url || packageJson.homepage || null,
    licenseType: metadata.pricing?.licenseType || "free",
    priceCents: metadata.pricing?.priceCents || 0,
  };

  // Send mutation
  const result = await client.request(PUBLISH_PACKAGE_MUTATION, {
    token: apiToken,
    input,
  });

  if (!result.publishPackage.success) {
    throw new Error(result.publishPackage.message);
  }
}
