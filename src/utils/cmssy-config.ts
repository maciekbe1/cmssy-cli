import fs from "fs-extra";
import path from "path";

export interface CmssyConfig {
  framework: string;
  projectName?: string;
  author?: {
    name: string;
    email: string;
  };
  build?: {
    outDir: string;
    minify: boolean;
    sourcemap: boolean;
  };
}

export async function loadConfig(): Promise<CmssyConfig> {
  const configPath = path.join(process.cwd(), "cmssy.config.js");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      "cmssy.config.js not found. Are you in a cmssy-forge project?"
    );
  }

  // Dynamic import for ESM
  const configModule = await import(`file://${configPath}`);
  return configModule.default;
}

export function getPackageJson(packagePath: string) {
  const pkgPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return fs.readJsonSync(pkgPath);
}
