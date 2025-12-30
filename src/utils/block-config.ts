import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import { execSync } from "child_process";
import {
  BlockConfig,
  TemplateConfig,
  ResourceConfig,
  FieldConfig,
  RepeaterFieldConfig,
  SelectFieldConfig,
} from "../types/block-config.js";
import { getFieldTypes, isValidFieldType } from "./field-schema.js";

// Helper function for type-safe config authoring
export function defineBlock(config: BlockConfig): BlockConfig {
  return config;
}

export function defineTemplate(config: TemplateConfig): TemplateConfig {
  return config;
}

// Load block.config.ts dynamically
export async function loadBlockConfig(
  blockPath: string
): Promise<ResourceConfig | null> {
  const configPath = path.join(blockPath, "block.config.ts");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    // Find tsx binary - try multiple locations
    const cliPath = path.dirname(path.dirname(new URL(import.meta.url).pathname));

    // Possible locations for tsx binary
    const possibleTsxPaths = [
      path.join(cliPath, "node_modules", ".bin", "tsx"),
      path.join(cliPath, "..", "..", "node_modules", ".bin", "tsx"), // If symlinked
      path.join(process.cwd(), "node_modules", ".bin", "tsx"), // Project's node_modules
    ];

    let tsxBinary = possibleTsxPaths.find(p => fs.existsSync(p));

    // If not found, use npx as fallback
    if (!tsxBinary) {
      tsxBinary = "npx -y tsx"; // Use npx with -y to auto-install if needed
    }

    const cacheDir = path.join(process.cwd(), ".cmssy", "cache");
    fs.ensureDirSync(cacheDir);

    // Create a mock cmssy-cli/config module in cache
    const mockConfigPath = path.join(cacheDir, "cmssy-cli-config.mjs");
    const mockConfig = `export const defineBlock = (config) => config;\nexport const defineTemplate = (config) => config;`;
    fs.writeFileSync(mockConfigPath, mockConfig);

    // Read original config and replace import path to point to mock
    const configContent = fs.readFileSync(configPath, "utf-8");
    const modifiedConfig = configContent.replace(
      /from\s+['"]cmssy-cli\/config['"]/g,
      `from '${mockConfigPath.replace(/\\/g, '/')}'`
    );

    // Write modified config to temp file
    const tempConfigPath = path.join(cacheDir, `temp-${path.basename(configPath)}`);
    fs.writeFileSync(tempConfigPath, modifiedConfig);

    // Execute with tsx - use --eval to import and output
    const evalCode = `import cfg from '${tempConfigPath.replace(/\\/g, '/')}'; console.log(JSON.stringify(cfg.default || cfg));`;

    // Build command - handle both direct binary path and npx
    const command = tsxBinary.includes("npx")
      ? `${tsxBinary} --eval "${evalCode}"`
      : `"${tsxBinary}" --eval "${evalCode}"`;

    const output = execSync(command, {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Clean up
    fs.removeSync(tempConfigPath);
    fs.removeSync(mockConfigPath);

    // Parse JSON output
    const lines = output.trim().split("\n");
    const jsonLine = lines[lines.length - 1];
    const config = JSON.parse(jsonLine);
    return config;
  } catch (error: any) {
    throw new Error(
      `Failed to load block.config.ts at ${configPath}: ${error.message}`
    );
  }
}

// Validate schema against backend field types
export async function validateSchema(
  schema: Record<string, FieldConfig>,
  blockPath: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const fieldTypes = await getFieldTypes();

  function validateField(
    key: string,
    field: FieldConfig,
    parentPath = ""
  ): void {
    const fullPath = parentPath ? `${parentPath}.${key}` : key;

    // Check if field type is valid
    if (!isValidFieldType(field.type, fieldTypes)) {
      errors.push(
        `Invalid field type "${field.type}" for field "${fullPath}". Valid types: ${fieldTypes.map((ft) => ft.type).join(", ")}`
      );
    }

    // Validate repeater nested schema
    if (field.type === "repeater") {
      const repeaterField = field as RepeaterFieldConfig;
      if (!repeaterField.schema || typeof repeaterField.schema !== "object") {
        errors.push(
          `Repeater field "${fullPath}" must have a "schema" property`
        );
      } else {
        // Recursively validate nested schema
        Object.entries(repeaterField.schema).forEach(
          ([nestedKey, nestedField]) => {
            validateField(nestedKey, nestedField as FieldConfig, fullPath);
          }
        );
      }

      // Validate minItems/maxItems
      if (repeaterField.minItems !== undefined && repeaterField.minItems < 0) {
        errors.push(
          `Repeater field "${fullPath}" has invalid minItems (must be >= 0)`
        );
      }
      if (repeaterField.maxItems !== undefined && repeaterField.maxItems < 1) {
        errors.push(
          `Repeater field "${fullPath}" has invalid maxItems (must be >= 1)`
        );
      }
      if (
        repeaterField.minItems &&
        repeaterField.maxItems &&
        repeaterField.minItems > repeaterField.maxItems
      ) {
        errors.push(
          `Repeater field "${fullPath}" has minItems > maxItems`
        );
      }
    }

    // Validate select options
    if (field.type === "select") {
      const selectField = field as SelectFieldConfig;
      if (
        !selectField.options ||
        !Array.isArray(selectField.options) ||
        selectField.options.length === 0
      ) {
        errors.push(
          `Select field "${fullPath}" must have at least one option`
        );
      }
    }

    // Warn about required fields with default values
    if (field.required && field.defaultValue !== undefined) {
      console.warn(
        chalk.yellow(
          `Warning: Field "${fullPath}" is required but has a defaultValue. The defaultValue will be ignored.`
        )
      );
    }
  }

  Object.entries(schema).forEach(([key, field]) => {
    validateField(key, field);
  });

  return { valid: errors.length === 0, errors };
}

// Generate package.json cmssy section from block.config.ts
export function generatePackageJsonMetadata(
  config: ResourceConfig,
  packageType: "block" | "template"
): any {
  // Convert schema to legacy schemaFields format
  const schemaFields = convertSchemaToLegacyFormat(config.schema);

  // Extract default content from schema
  const defaultContent = extractDefaultContent(config.schema);

  return {
    packageType,
    displayName: config.name,
    description: config.description,
    longDescription: config.longDescription,
    category: config.category || (packageType === "template" ? "pages" : "other"),
    tags: config.tags || [],
    pricing: config.pricing || { licenseType: "free" },
    schemaFields,
    defaultContent,
  };
}

function convertSchemaToLegacyFormat(
  schema: Record<string, FieldConfig>
): any[] {
  const fields: any[] = [];

  function convertField(key: string, field: FieldConfig): any {
    const baseField: any = {
      key,
      type: field.type,
      label: field.label,
      required: field.required || false,
    };

    if (field.placeholder) {
      baseField.placeholder = field.placeholder;
    }

    if (field.type === "select") {
      const selectField = field as SelectFieldConfig;
      baseField.options = selectField.options;
    }

    if (field.type === "repeater") {
      const repeaterField = field as RepeaterFieldConfig;
      const nestedFields = convertSchemaToLegacyFormat(repeaterField.schema);
      baseField.minItems = repeaterField.minItems;
      baseField.maxItems = repeaterField.maxItems;
      baseField.itemSchema = {
        type: "object",
        fields: nestedFields,
      };
    }

    return baseField;
  }

  Object.entries(schema).forEach(([key, field]) => {
    fields.push(convertField(key, field));
  });

  return fields;
}

function extractDefaultContent(schema: Record<string, FieldConfig>): any {
  const content: any = {};

  Object.entries(schema).forEach(([key, field]) => {
    if (field.defaultValue !== undefined) {
      content[key] = field.defaultValue;
    } else if (field.type === "repeater") {
      // Repeaters default to empty array
      content[key] = [];
    }
  });

  return content;
}
