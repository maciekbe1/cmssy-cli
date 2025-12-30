import chalk from "chalk";
import chokidar from "chokidar";
import { build } from "esbuild";
import { execSync } from "child_process";
import express from "express";
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

interface DevOptions {
  port: string;
}

interface Resource {
  type: "block" | "template";
  name: string;
  path: string;
  displayName: string;
  description?: string;
  category?: string;
  previewData: any;
  blockConfig?: ResourceConfig;
  packageJson?: any;
}

export async function devCommand(options: DevOptions) {
  const spinner = ora("Starting development server...").start();

  try {
    const config = await loadConfig();
    const port = parseInt(options.port, 10);

    // Scan for blocks and templates
    const resources = await scanResources();

    if (resources.length === 0) {
      spinner.warn("No blocks or templates found");
      console.log(chalk.yellow("\nCreate your first block:\n"));
      console.log(chalk.white("  npx cmssy create block my-block\n"));
      process.exit(0);
    }

    // Build all resources initially
    spinner.text = "Building resources...";
    await buildAllResources(resources, config);

    // Create Express server
    const app = express();

    // SSE clients for hot reload
    const sseClients: any[] = [];

    // SSE endpoint for hot reload
    app.get("/events", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      sseClients.push(res);

      req.on("close", () => {
        const index = sseClients.indexOf(res);
        if (index !== -1) sseClients.splice(index, 1);
      });
    });

    // Setup file watcher with SSE notifications
    const watcher = setupWatcher(resources, config, sseClients);

    // Serve static files
    app.use(
      "/assets",
      express.static(path.join(process.cwd(), ".cmssy", "dev"))
    );

    // API endpoint to list resources
    app.get("/api/resources", (_req, res) => {
      const resourceList = resources.map((r) => ({
        type: r.type,
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        category: r.category,
      }));
      res.json(resourceList);
    });

    // Preview page for a specific resource
    app.get("/preview/:type/:name", async (req, res) => {
      const { type, name } = req.params;
      const resource = resources.find(
        (r) => r.type === type && r.name === name
      );

      if (!resource) {
        res.status(404).send("Resource not found");
        return;
      }

      const html = generatePreviewHTML(resource, config);
      res.send(html);
    });

    // Home page with resource list
    app.get("/", (_req, res) => {
      const html = generateIndexHTML(resources);
      res.send(html);
    });

    // Start server
    app.listen(port, () => {
      spinner.succeed("Development server started");
      console.log(
        chalk.green.bold("\n┌─────────────────────────────────────────┐")
      );
      console.log(
        chalk.green.bold("│   Cmssy Dev Server                      │")
      );
      console.log(
        chalk.green.bold("├─────────────────────────────────────────┤")
      );
      console.log(chalk.green("│                                         │"));

      const blocks = resources.filter((r) => r.type === "block");
      const templates = resources.filter((r) => r.type === "template");

      if (blocks.length > 0) {
        console.log(
          chalk.cyan(
            `│   Blocks (${blocks.length})                           │`
          )
        );
        blocks.forEach((block) => {
          const url = `/preview/block/${block.name}`;
          console.log(
            chalk.white(
              `│   ● ${block.displayName.padEnd(20)} ${url.padEnd(15)}│`
            )
          );
        });
        console.log(chalk.green("│                                         │"));
      }

      if (templates.length > 0) {
        console.log(
          chalk.cyan(
            `│   Templates (${templates.length})                       │`
          )
        );
        templates.forEach((template) => {
          const url = `/preview/template/${template.name}`;
          console.log(
            chalk.white(
              `│   ● ${template.displayName.padEnd(20)} ${url.padEnd(15)}│`
            )
          );
        });
        console.log(chalk.green("│                                         │"));
      }

      console.log(
        chalk.green(
          `│   Local:   ${chalk.cyan(`http://localhost:${port}`).padEnd(36)}│`
        )
      );
      console.log(chalk.green("│   Hot reload enabled ✓                  │"));
      console.log(
        chalk.green.bold("└─────────────────────────────────────────┘\n")
      );
    });
  } catch (error) {
    spinner.fail("Failed to start development server");
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
          console.warn(
            chalk.yellow(
              `Warning: Block "${blockName}" uses legacy package.json format. Run: cmssy migrate ${blockName}`
            )
          );
        }
        continue;
      }

      // Validate schema
      const validation = await validateSchema(blockConfig.schema, blockPath);
      if (!validation.valid) {
        console.warn(chalk.yellow(`\nValidation warnings in ${blockName}:`));
        validation.errors.forEach((err) => console.warn(chalk.yellow(`  - ${err}`)));
        continue;
      }

      // Load package.json for name and version
      const pkg = getPackageJson(blockPath);
      if (!pkg || !pkg.name || !pkg.version) {
        console.warn(
          chalk.yellow(
            `Warning: Block "${blockName}" must have package.json with name and version`
          )
        );
        continue;
      }

      const previewPath = path.join(blockPath, "preview.json");
      const previewData = fs.existsSync(previewPath)
        ? fs.readJsonSync(previewPath)
        : {};

      resources.push({
        type: "block",
        name: blockName,
        path: blockPath,
        displayName: blockConfig.name || blockName,
        description: blockConfig.description || pkg.description,
        category: blockConfig.category,
        previewData,
        blockConfig,
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

      // Try loading block.config.ts
      const blockConfig = await loadBlockConfig(templatePath);

      if (!blockConfig) {
        // Check if package.json has cmssy (old format)
        const pkg = getPackageJson(templatePath);
        if (pkg && pkg.cmssy) {
          console.warn(
            chalk.yellow(
              `Warning: Template "${templateName}" uses legacy package.json format. Run: cmssy migrate ${templateName}`
            )
          );
        }
        continue;
      }

      // Validate schema
      const validation = await validateSchema(blockConfig.schema, templatePath);
      if (!validation.valid) {
        console.warn(chalk.yellow(`\nValidation warnings in ${templateName}:`));
        validation.errors.forEach((err) => console.warn(chalk.yellow(`  - ${err}`)));
        continue;
      }

      // Load package.json for name and version
      const pkg = getPackageJson(templatePath);
      if (!pkg || !pkg.name || !pkg.version) {
        console.warn(
          chalk.yellow(
            `Warning: Template "${templateName}" must have package.json with name and version`
          )
        );
        continue;
      }

      const previewPath = path.join(templatePath, "preview.json");
      const previewData = fs.existsSync(previewPath)
        ? fs.readJsonSync(previewPath)
        : {};

      resources.push({
        type: "template",
        name: templateName,
        path: templatePath,
        displayName: blockConfig.name || templateName,
        description: blockConfig.description || pkg.description,
        category: blockConfig.category,
        previewData,
        blockConfig,
        packageJson: pkg,
      });
    }
  }

  return resources;
}

async function buildAllResources(resources: Resource[], config: any) {
  const devDir = path.join(process.cwd(), ".cmssy", "dev");
  fs.ensureDirSync(devDir);

  for (const resource of resources) {
    await buildResource(resource, config, devDir);
  }
}

async function buildResource(resource: Resource, config: any, outDir: string) {
  const srcPath = path.join(resource.path, "src");
  const entryPoint =
    config.framework === "react"
      ? path.join(srcPath, "index.tsx")
      : path.join(srcPath, "index.ts");

  if (!fs.existsSync(entryPoint)) {
    console.warn(
      chalk.yellow(`Warning: Entry point not found for ${resource.name}`)
    );
    return;
  }

  const outFile = path.join(outDir, `${resource.type}.${resource.name}.js`);

  try {
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: "esm",
      outfile: outFile,
      jsx: "transform",
      minify: false,
      sourcemap: true,
      target: "es2020",
      external: ["*.css"],
    });

    // Process CSS with PostCSS if exists
    const cssPath = path.join(srcPath, "index.css");
    if (fs.existsSync(cssPath)) {
      const outCssFile = path.join(
        outDir,
        `${resource.type}.${resource.name}.css`
      );

      // Check if postcss.config.js exists (Tailwind enabled)
      const postcssConfigPath = path.join(process.cwd(), "postcss.config.js");

      if (fs.existsSync(postcssConfigPath)) {
        // Use PostCSS to process CSS (includes Tailwind)
        try {
          execSync(`npx postcss "${cssPath}" -o "${outCssFile}"`, {
            stdio: "pipe",
            cwd: process.cwd(),
          });
        } catch (error: any) {
          console.warn(
            chalk.yellow(
              `Warning: PostCSS processing failed for ${resource.name}: ${error.message}`
            )
          );
          console.log(chalk.gray("Copying CSS as-is..."));
          fs.copyFileSync(cssPath, outCssFile);
        }
      } else {
        // No PostCSS config - just copy CSS
        fs.copyFileSync(cssPath, outCssFile);
      }
    }
  } catch (error) {
    console.error(chalk.red(`Build error for ${resource.name}:`), error);
  }
}

function setupWatcher(resources: Resource[], config: any, sseClients: any[]) {
  const devDir = path.join(process.cwd(), ".cmssy", "dev");

  // Watch directories directly instead of globs (globs don't work reliably in chokidar)
  const watchPaths: string[] = [];
  const blocksDir = path.join(process.cwd(), "blocks");
  const templatesDir = path.join(process.cwd(), "templates");

  if (fs.existsSync(blocksDir)) watchPaths.push(blocksDir);
  if (fs.existsSync(templatesDir)) watchPaths.push(templatesDir);

  console.log(chalk.gray(`\nSetting up watcher for:`));
  watchPaths.forEach((p) => console.log(chalk.gray(`  ${p}`)));

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  // Debug: log all watcher events
  watcher.on("add", (filepath) => {
    console.log(chalk.gray(`File added: ${filepath}`));
  });

  watcher.on("change", async (filepath) => {
    console.log(chalk.yellow(`\n📝 File changed: ${filepath}`));

    // Check if it's a block.config.ts file
    if (filepath.endsWith("block.config.ts")) {
      console.log(chalk.blue(`⚙️  Configuration changed, reloading and regenerating types...`));
    }

    // Extract resource name from path (e.g., "blocks/hero/src/Hero.tsx" -> "hero")
    const pathParts = filepath.split(path.sep);
    const blockOrTemplateIndex = pathParts.indexOf("blocks") !== -1
      ? pathParts.indexOf("blocks")
      : pathParts.indexOf("templates");

    if (blockOrTemplateIndex === -1) return;

    const resourceName = pathParts[blockOrTemplateIndex + 1];
    const resource = resources.find((r) => r.name === resourceName);

    if (resource) {
      // Reload block.config.ts if it changed
      if (filepath.endsWith("block.config.ts")) {
        const blockConfig = await loadBlockConfig(resource.path);
        if (blockConfig) {
          resource.blockConfig = blockConfig;
          resource.displayName = blockConfig.name || resource.name;
          resource.description = blockConfig.description;
          resource.category = blockConfig.category;

          // Regenerate types
          await generateTypes(resource.path, blockConfig.schema);
          console.log(chalk.green(`✓ Types regenerated for ${resource.name}`));
        }
      }

      console.log(chalk.blue(`♻  Rebuilding ${resource.name}...`));
      await buildResource(resource, config, devDir);
      console.log(chalk.green(`✓ ${resource.name} rebuilt\n`));

      // Notify SSE clients to reload
      sseClients.forEach((client) => {
        try {
          client.write(`data: ${JSON.stringify({ type: "reload" })}\n\n`);
        } catch (error) {
          // Client disconnected
        }
      });
    } else {
      console.log(chalk.yellow(`Warning: Could not find resource for ${filepath}`));
    }
  });

  watcher.on("ready", () => {
    const watched = watcher.getWatched();
    console.log(chalk.gray("\nFile watcher ready. Watching:"));
    Object.keys(watched).forEach((dir) => {
      if (watched[dir].length > 0) {
        console.log(chalk.gray(`  ${dir}/`));
      }
    });
  });

  watcher.on("error", (error) => {
    console.error(chalk.red("Watcher error:"), error);
  });

  return watcher;
}

function generateIndexHTML(resources: Resource[]): string {
  const blocks = resources.filter((r) => r.type === "block");
  const templates = resources.filter((r) => r.type === "template");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cmssy Dev Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    .subtitle { color: #666; margin-bottom: 3rem; }
    .section { margin-bottom: 3rem; }
    .section-title { font-size: 1.5rem; margin-bottom: 1rem; color: #333; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .card-title { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .card-desc { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
    .card-category {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: #e3f2fd;
      color: #1976d2;
      border-radius: 4px;
      font-size: 0.8rem;
      margin-bottom: 1rem;
    }
    .card-link {
      display: inline-block;
      padding: 0.5rem 1rem;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-weight: 500;
    }
    .card-link:hover { background: #5568d3; }
    .empty {
      text-align: center;
      padding: 3rem;
      color: #999;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔨 Cmssy</h1>
    <p class="subtitle">Development Server</p>

    ${
      blocks.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Blocks (${blocks.length})</h2>
        <div class="grid">
          ${blocks
            .map(
              (block) => `
            <div class="card">
              <h3 class="card-title">${block.displayName}</h3>
              ${
                block.description
                  ? `<p class="card-desc">${block.description}</p>`
                  : ""
              }
              ${
                block.category
                  ? `<div class="card-category">${block.category}</div>`
                  : ""
              }
              <a href="/preview/block/${
                block.name
              }" class="card-link">Preview →</a>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `
        : '<div class="empty">No blocks found. Create one with: <code>npx cmssy create block my-block</code></div>'
    }

    ${
      templates.length > 0
        ? `
      <div class="section">
        <h2 class="section-title">Templates (${templates.length})</h2>
        <div class="grid">
          ${templates
            .map(
              (template) => `
            <div class="card">
              <h3 class="card-title">${template.displayName}</h3>
              ${
                template.description
                  ? `<p class="card-desc">${template.description}</p>`
                  : ""
              }
              <a href="/preview/template/${
                template.name
              }" class="card-link">Preview →</a>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `
        : ""
    }
  </div>
</body>
</html>
  `;
}

function generatePreviewHTML(resource: Resource, config: any): string {
  const timestamp = Date.now();
  const jsPath = `/assets/${resource.type}.${resource.name}.js?v=${timestamp}`;
  const cssPath = `/assets/${resource.type}.${resource.name}.css?v=${timestamp}`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${resource.displayName} - Preview</title>
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <link rel="stylesheet" href="${cssPath}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .preview-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 1rem 2rem;
      z-index: 1000;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .preview-title {
      font-size: 1.25rem;
      font-weight: 600;
    }
    .preview-back {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
    .preview-container {
      margin-top: 60px;
      min-height: calc(100vh - 60px);
    }
  </style>
</head>
<body>
  <div class="preview-header">
    <div class="preview-title">${resource.displayName}</div>
    <a href="/" class="preview-back">← Back to Home</a>
  </div>
  <div class="preview-container">
    <div id="preview-root"></div>
  </div>

  <script type="module">
    import module from '${jsPath}';
    const element = document.getElementById('preview-root');
    const props = ${JSON.stringify(resource.previewData)};
    module.mount(element, props);
  </script>

  <!-- Hot Reload SSE -->
  <script>
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
      const data = JSON.parse(event.data);
      if (data.type === 'reload') {
        console.log('🔄 Hot reload: Changes detected, reloading...');
        window.location.reload();
      }
    };
    evtSource.onerror = function() {
      console.warn('SSE connection lost, retrying...');
    };
  </script>
</body>
</html>
  `;
}
