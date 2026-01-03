import chalk from "chalk";
import ora from "ora";
import path from "path";
import { loadConfig } from "../utils/cmssy-config.js";
import { scanResources } from "../utils/scanner.js";
import { buildResource } from "../utils/builder.js";

interface BuildOptions {
  framework?: string;
}

export async function buildCommand(options: BuildOptions) {
  const spinner = ora("Starting build...").start();

  try {
    const config = await loadConfig();
    const framework = options.framework || config.framework;

    // Scan for blocks and templates (strict mode - throw errors)
    const resources = await scanResources({
      strict: true,
      loadConfig: true,
      validateSchema: true,
      loadPreview: false,
      requirePackageJson: true,
    });

    if (resources.length === 0) {
      spinner.warn("No blocks or templates found");
      process.exit(0);
    }

    spinner.text = `Building ${resources.length} resources...`;

    const outDir = path.join(process.cwd(), config.build?.outDir || "public");

    let successCount = 0;
    let errorCount = 0;

    for (const resource of resources) {
      try {
        await buildResource(resource, outDir, {
          framework,
          minify: config.build?.minify ?? true,
          sourcemap: config.build?.sourcemap ?? true,
          outputMode: "versioned",
          generatePackageJson: true,
          generateTypes: true,
          strict: true,
        });
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
