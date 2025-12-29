import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, saveConfig } from "../utils/config.js";

interface ConfigureOptions {
  apiUrl?: string;
}

export async function configureCommand(options: ConfigureOptions) {
  console.log(chalk.blue.bold("\n🔨 Cmssy Forge - Configure\n"));

  const existingConfig = loadConfig();

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "apiUrl",
      message: "Cmssy API URL:",
      default:
        options.apiUrl ||
        existingConfig.apiUrl ||
        "https://api.cmssy.io/graphql",
    },
    {
      type: "password",
      name: "apiToken",
      message: "Cmssy API Token (from /settings/tokens):",
      default: existingConfig.apiToken || undefined,
      validate: (input) => {
        if (!input || input.length < 10) {
          return "Please enter a valid API token";
        }
        if (!input.startsWith("bf_")) {
          return 'Token should start with "bf_"';
        }
        return true;
      },
    },
  ]);

  // Save to .env
  saveConfig({
    apiUrl: answers.apiUrl,
    apiToken: answers.apiToken,
  });

  console.log(chalk.green("\n✓ Configuration saved to .env\n"));
  console.log(chalk.cyan("Next steps:\n"));
  console.log(
    chalk.white("  cmssy-forge deploy      # Publish to marketplace")
  );
  console.log(
    chalk.white("  cmssy-forge sync        # Pull blocks from Cmssy\n")
  );
}
