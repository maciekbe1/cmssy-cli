import chalk from "chalk";
import { exec } from "child_process";
import chokidar from "chokidar";
import express from "express";
import fs from "fs-extra";
import { GraphQLClient } from "graphql-request";
import ora from "ora";
import path from "path";
import { fileURLToPath } from "url";
import { scanResources, ScannedResource } from "../utils/scanner.js";
import { buildResource } from "../utils/builder.js";
import { loadBlockConfig, validateSchema } from "../utils/block-config.js";
import { loadConfig } from "../utils/cmssy-config.js";
import { loadConfig as loadEnvConfig } from "../utils/config.js";
import { generateTypes } from "../utils/type-generator.js";
import { ResourceConfig } from "../types/block-config.js";

interface DevOptions {
  port: string;
}

// Use ScannedResource from scanner
type Resource = ScannedResource;

export async function devCommand(options: DevOptions) {
  const spinner = ora("Starting development server...").start();

  try {
    const config = await loadConfig();
    const port = parseInt(options.port, 10);

    // Scan for blocks and templates (lenient mode - warnings only)
    const resources = await scanResources({
      strict: false,
      loadConfig: true,
      validateSchema: true,
      loadPreview: true,
      requirePackageJson: true,
    });

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
    app.use(express.json()); // Parse JSON bodies

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

    // Serve dev UI static files
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const devUiPath = path.join(__dirname, "../dev-ui");
    app.use("/dev-ui", express.static(devUiPath));

    // API: Get all blocks with schema (including version and package name)
    app.get("/api/blocks", (_req, res) => {
      const blockList = resources.map((r) => ({
        type: r.type,
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        category: r.category,
        schema: r.blockConfig?.schema || {},
        version: r.packageJson?.version || "1.0.0",
        packageName: r.packageJson?.name || `@local/${r.type}s.${r.name}`,
      }));
      res.json(blockList);
    });

    // API: Get user's workspaces
    app.get("/api/workspaces", async (_req, res) => {
      try {
        const config = loadEnvConfig();

        if (!config.apiToken) {
          res.status(401).json({
            error: "API token not configured",
            message: "Run 'cmssy configure' to set up your API credentials",
          });
          return;
        }

        const client = new GraphQLClient(config.apiUrl, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiToken}`,
          },
        });

        const query = `
          query MyWorkspaces {
            myWorkspaces {
              id
              slug
              name
              myRole
            }
          }
        `;

        const data: any = await client.request(query);
        res.json(data.myWorkspaces || []);
      } catch (error: any) {
        console.error("Failed to fetch workspaces:", error);
        res.status(500).json({
          error: "Failed to fetch workspaces",
          message: error.message || "Unknown error",
        });
      }
    });

    // API: Get preview data for a block
    app.get("/api/preview/:blockName", (req, res) => {
      const { blockName } = req.params;
      const resource = resources.find((r) => r.name === blockName);

      if (!resource) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      res.json(resource.previewData);
    });

    // API: Save preview data for a block
    app.post("/api/preview/:blockName", (req, res) => {
      const { blockName } = req.params;
      const newPreviewData = req.body;

      const resource = resources.find((r) => r.name === blockName);

      if (!resource) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      // Update in-memory preview data
      resource.previewData = newPreviewData;

      // Save to preview.json
      const previewPath = path.join(resource.path, "preview.json");
      try {
        fs.writeJsonSync(previewPath, newPreviewData, { spaces: 2 });

        // NO SSE reload for preview.json changes - UI handles updates via postMessage
        // SSE reload is only for source code changes (handled by watcher)

        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Publish task tracking
    const publishTasks = new Map<string, any>();

    // API: Get block publish status
    app.get("/api/blocks/:name/status", (req, res) => {
      const { name } = req.params;
      const resource = resources.find((r) => r.name === name);

      if (!resource) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      res.json({
        name: resource.name,
        version: resource.packageJson?.version || "1.0.0",
        packageName:
          resource.packageJson?.name ||
          `@local/${resource.type}s.${resource.name}`,
        published: false, // TODO: Check actual publish status from backend
        lastPublished: null,
      });
    });

    // API: Trigger publish
    app.post("/api/blocks/:name/publish", async (req, res) => {
      const { name } = req.params;
      const { target, workspaceId, versionBump } = req.body;

      const resource = resources.find((r) => r.name === name);

      if (!resource) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      // Validate target
      if (!target || (target !== "marketplace" && target !== "workspace")) {
        res.status(400).json({
          error: "Invalid target. Must be 'marketplace' or 'workspace'",
        });
        return;
      }

      if (target === "workspace" && !workspaceId) {
        res
          .status(400)
          .json({ error: "Workspace ID required for workspace publish" });
        return;
      }

      // Create task ID
      const taskId = `publish-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // Store task
      publishTasks.set(taskId, {
        id: taskId,
        blockName: name,
        status: "pending",
        progress: 0,
        steps: [],
        error: null,
      });

      // Start async publish
      executePublish(
        taskId,
        resource,
        target,
        workspaceId,
        versionBump,
        publishTasks
      );

      res.json({ taskId, status: "started" });
    });

    // API: Get publish progress (SSE)
    app.get("/api/publish/progress/:taskId", (req, res) => {
      const { taskId } = req.params;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Send initial state
      const task = publishTasks.get(taskId);
      if (task) {
        res.write(`data: ${JSON.stringify(task)}\n\n`);
      }

      // Poll for updates every 500ms
      const interval = setInterval(() => {
        const task = publishTasks.get(taskId);
        if (task) {
          res.write(`data: ${JSON.stringify(task)}\n\n`);

          // Close when done
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(interval);
            res.end();
          }
        }
      }, 500);

      req.on("close", () => {
        clearInterval(interval);
      });
    });

    // API endpoint to list resources (legacy)
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

    // Preview page for a specific resource (simplified route)
    app.get("/preview/:name", async (req, res) => {
      const { name } = req.params;
      const resource = resources.find((r) => r.name === name);

      if (!resource) {
        res.status(404).send("Resource not found");
        return;
      }

      const html = generatePreviewHTML(resource, config);
      res.send(html);
    });

    // Legacy preview route
    app.get("/preview/:type/:name", async (req, res) => {
      const { name } = req.params;
      const resource = resources.find((r) => r.name === name);

      if (!resource) {
        res.status(404).send("Resource not found");
        return;
      }

      const html = generatePreviewHTML(resource, config);
      res.send(html);
    });

    // Home page - Serve interactive UI
    app.get("/", (_req, res) => {
      const indexPath = path.join(devUiPath, "index.html");
      res.sendFile(indexPath);
    });

    // Start server
    app.listen(port, () => {
      spinner.succeed("Development server started");
      console.log(
        chalk.green.bold("\n─────────────────────────────────────────")
      );
      console.log(chalk.green.bold("   Cmssy Dev Server"));
      console.log(
        chalk.green.bold("─────────────────────────────────────────")
      );
      console.log("");

      const blocks = resources.filter((r) => r.type === "block");
      const templates = resources.filter((r) => r.type === "template");

      if (blocks.length > 0) {
        console.log(chalk.cyan(`   Blocks (${blocks.length})`));
        blocks.forEach((block) => {
          const url = `/preview/block/${block.name}`;
          console.log(
            chalk.white(`   ● ${(block.displayName || block.name).padEnd(20)} ${url}`)
          );
        });
        console.log("");
      }

      if (templates.length > 0) {
        console.log(chalk.cyan(`   Templates (${templates.length})`));
        templates.forEach((template) => {
          const url = `/preview/template/${template.name}`;
          console.log(
            chalk.white(`   ● ${(template.displayName || template.name).padEnd(20)} ${url}`)
          );
        });
        console.log("");
      }

      console.log(
        chalk.green(`   Local:   ${chalk.cyan(`http://localhost:${port}`)}`)
      );
      console.log(chalk.green("   Hot reload enabled ✓"));
      console.log(
        chalk.green.bold("─────────────────────────────────────────\n")
      );
    });
  } catch (error) {
    spinner.fail("Failed to start development server");
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

async function buildAllResources(resources: Resource[], config: any) {
  const devDir = path.join(process.cwd(), ".cmssy", "dev");
  fs.ensureDirSync(devDir);

  for (const resource of resources) {
    await buildResource(resource, devDir, {
      framework: config.framework,
      minify: false,
      sourcemap: true,
      outputMode: "flat",
      generatePackageJson: false,
      generateTypes: false, // Types are generated during scan
      strict: false,
    });
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
    ignored: [
      "**/preview.json", // Ignore preview.json changes (handled via postMessage)
      "**/.cmssy/**",
      "**/node_modules/**",
      "**/.git/**",
    ],
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

    // IGNORE preview.json changes - handled via postMessage for instant updates
    if (filepath.endsWith("preview.json")) {
      console.log(
        chalk.gray(`   Skipping preview.json (props updated via UI)`)
      );
      return;
    }

    // Check if it's a block.config.ts file
    if (filepath.endsWith("block.config.ts")) {
      console.log(
        chalk.blue(
          `⚙️  Configuration changed, reloading and regenerating types...`
        )
      );
    }

    // Extract resource name from path (e.g., "blocks/hero/src/Hero.tsx" -> "hero")
    const pathParts = filepath.split(path.sep);
    const blockOrTemplateIndex =
      pathParts.indexOf("blocks") !== -1
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
      await buildResource(resource, devDir, {
        framework: config.framework,
        minify: false,
        sourcemap: true,
        outputMode: "flat",
        generatePackageJson: false,
        generateTypes: false, // Already generated above
        strict: false,
      });
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
      console.log(
        chalk.yellow(`Warning: Could not find resource for ${filepath}`)
      );
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

// Execute publish command asynchronously
async function executePublish(
  taskId: string,
  resource: Resource,
  target: string,
  workspaceId: string | undefined,
  versionBump: string | undefined,
  publishTasks: Map<string, any>
) {
  const task = publishTasks.get(taskId);
  if (!task) return;

  try {
    // Update: Building
    task.status = "building";
    task.progress = 10;
    task.steps.push({
      step: "building",
      status: "in_progress",
      message: "Building block...",
    });

    // Build command args
    let args = ["publish", resource.name, `--${target}`];

    if (target === "workspace" && workspaceId) {
      args.push(workspaceId);
    }

    if (versionBump) {
      args.push(`--${versionBump}`);
    }

    task.steps[task.steps.length - 1].status = "completed";
    task.steps.push({
      step: "validating",
      status: "in_progress",
      message: "Validating configuration...",
    });
    task.progress = 30;

    // Execute cmssy publish command (use global CLI)
    const command = `cmssy ${args.join(" ")}`;

    task.steps[task.steps.length - 1].status = "completed";
    task.steps.push({
      step: "publishing",
      status: "in_progress",
      message: `Publishing to ${target}...`,
    });
    task.progress = 50;

    // Execute command
    await new Promise<void>((resolve, reject) => {
      exec(
        command,
        {
          cwd: process.cwd(),
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        },
        (error: any, stdout: string, stderr: string) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve();
          }
        }
      );
    });

    task.steps[task.steps.length - 1].status = "completed";
    task.progress = 100;
    task.status = "completed";
    task.steps.push({
      step: "completed",
      status: "completed",
      message:
        target === "marketplace"
          ? "Submitted for review. You'll be notified when approved."
          : "Published to workspace successfully!",
    });
  } catch (error: any) {
    task.status = "failed";
    task.error = error.message;
    if (task.steps.length > 0) {
      task.steps[task.steps.length - 1].status = "failed";
    }
    task.steps.push({
      step: "error",
      status: "failed",
      message: `Error: ${error.message}`,
    });
  }
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
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%23667eea'/%3E%3Ctext x='50' y='70' font-size='60' font-weight='bold' text-anchor='middle' fill='white' font-family='system-ui'%3EC%3C/text%3E%3C/svg%3E">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <link rel="stylesheet" href="${cssPath}">
  <style>
    /* Only reset body and preview UI elements, NOT block content */
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
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
      margin: 0;
      box-sizing: border-box;
    }
    .preview-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
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
    <a href="/" class="preview-back" target="_parent">← Back to Home</a>
  </div>
  <div class="preview-container">
    <div id="preview-root"></div>
  </div>

  <script type="module">
    import module from '${jsPath}';
    const element = document.getElementById('preview-root');
    let props = ${JSON.stringify(resource.previewData)};
    let context = module.mount(element, props);

    // Listen for prop updates from parent (no reload, just re-render)
    window.addEventListener('message', (event) => {
      if (event.data.type === 'UPDATE_PROPS') {
        console.log('⚡ Hot update: Props changed');
        props = event.data.props;

        // Use update method if available (no unmount = no blink!)
        if (module.update && context) {
          module.update(element, props, context);
        } else {
          // Fallback: unmount and remount (causes blink)
          if (context && module.unmount) {
            module.unmount(element, context);
          }
          context = module.mount(element, props);
        }
      }
    });
  </script>

  <!-- Hot Reload SSE (only for code changes) -->
  <script>
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
      const data = JSON.parse(event.data);
      if (data.type === 'reload') {
        console.log('🔄 Hot reload: Code changed, reloading...');
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
