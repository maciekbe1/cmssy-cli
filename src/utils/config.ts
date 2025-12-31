import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";

export interface CmssyConfig {
  apiUrl: string;
  apiToken: string | null;
  workspaceId?: string | null;
}

export function loadConfig(): CmssyConfig {
  // Load from .env in cwd
  const envPath = path.join(process.cwd(), ".env");

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  return {
    apiUrl: process.env.CMSSY_API_URL || "https://api.cmssy.io/graphql",
    apiToken: process.env.CMSSY_API_TOKEN || null,
    workspaceId: process.env.CMSSY_WORKSPACE_ID || null,
  };
}

export function saveConfig(config: Partial<CmssyConfig>): void {
  const envPath = path.join(process.cwd(), ".env");
  const existingEnv = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";

  let newEnv = existingEnv;

  // Update or add CMSSY_API_TOKEN
  if (config.apiToken !== undefined) {
    if (existingEnv.includes("CMSSY_API_TOKEN=")) {
      newEnv = newEnv.replace(
        /CMSSY_API_TOKEN=.*/,
        `CMSSY_API_TOKEN=${config.apiToken}`
      );
    } else {
      newEnv += `\nCMSSY_API_TOKEN=${config.apiToken}\n`;
    }
  }

  // Update or add CMSSY_API_URL
  if (config.apiUrl !== undefined) {
    if (existingEnv.includes("CMSSY_API_URL=")) {
      newEnv = newEnv.replace(
        /CMSSY_API_URL=.*/,
        `CMSSY_API_URL=${config.apiUrl}`
      );
    } else {
      newEnv += `CMSSY_API_URL=${config.apiUrl}\n`;
    }
  }

  fs.writeFileSync(envPath, newEnv.trim() + "\n");
}

export function hasConfig(): boolean {
  const config = loadConfig();
  return !!config.apiToken;
}
