import chalk from "chalk";
import fs from "fs-extra";
import ora from "ora";
import path from "path";
import { getPackageJson } from "../utils/cmssy-config.js";
import { generateTypes } from "../utils/type-generator.js";
import { FieldConfig } from "../types/block-config.js";

export async function migrateCommand(blockName?: string) {
  const spinner = ora("Starting migration...").start();

  try {
    const blocksToMigrate: string[] = [];

    if (blockName) {
      // Migrate specific block
      const blockPath = path.join(process.cwd(), "blocks", blockName);
      const templatePath = path.join(process.cwd(), "templates", blockName);

      if (fs.existsSync(blockPath)) {
        blocksToMigrate.push(path.join("blocks", blockName));
      } else if (fs.existsSync(templatePath)) {
        blocksToMigrate.push(path.join("templates", blockName));
      } else {
        spinner.fail(`Block or template "${blockName}" not found`);
        process.exit(1);
      }
    } else {
      // Migrate all blocks and templates
      const blocksDir = path.join(process.cwd(), "blocks");
      const templatesDir = path.join(process.cwd(), "templates");

      if (fs.existsSync(blocksDir)) {
        const dirs = fs
          .readdirSync(blocksDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join("blocks", d.name));
        blocksToMigrate.push(...dirs);
      }

      if (fs.existsSync(templatesDir)) {
        const dirs = fs
          .readdirSync(templatesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join("templates", d.name));
        blocksToMigrate.push(...dirs);
      }
    }

    if (blocksToMigrate.length === 0) {
      spinner.warn("No blocks or templates found to migrate");
      process.exit(0);
    }

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    spinner.stop();
    console.log(chalk.cyan(`\nFound ${blocksToMigrate.length} block(s)/template(s)\n`));

    for (const relativePath of blocksToMigrate) {
      const fullPath = path.join(process.cwd(), relativePath);
      const name = path.basename(fullPath);

      // Check if already migrated
      if (fs.existsSync(path.join(fullPath, "block.config.ts"))) {
        console.log(chalk.yellow(`  ⊘ ${name} - already migrated`));
        skippedCount++;
        continue;
      }

      // Load package.json
      const pkg = getPackageJson(fullPath);
      if (!pkg || !pkg.cmssy) {
        console.log(chalk.yellow(`  ⊘ ${name} - no cmssy metadata found`));
        skippedCount++;
        continue;
      }

      try {
        await migrateBlock(fullPath, pkg);
        console.log(chalk.green(`  ✓ ${name} - migrated successfully`));
        migratedCount++;
      } catch (error: any) {
        console.error(chalk.red(`  ✖ ${name} - ${error.message}`));
        errorCount++;
      }
    }

    console.log("");

    if (errorCount === 0) {
      console.log(chalk.green.bold(`✓ Migration complete!`));
      console.log(chalk.white(`  Migrated: ${migratedCount}`));
      console.log(chalk.white(`  Skipped: ${skippedCount}`));
      console.log(chalk.cyan("\nNext steps:"));
      console.log(chalk.white("  1. Review generated block.config.ts files"));
      console.log(chalk.white("  2. Run: cmssy build\n"));
    } else {
      console.log(chalk.yellow(`⚠ Migration completed with errors`));
      console.log(chalk.white(`  Migrated: ${migratedCount}`));
      console.log(chalk.white(`  Skipped: ${skippedCount}`));
      console.log(chalk.white(`  Errors: ${errorCount}\n`));
    }
  } catch (error) {
    spinner.fail("Migration failed");
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

async function migrateBlock(blockPath: string, pkg: any): Promise<void> {
  const cmssy = pkg.cmssy;
  const isTemplate = cmssy.packageType === "template";

  // Convert schemaFields to schema format
  const schema = convertLegacySchemaToNew(cmssy.schemaFields || []);

  // Merge defaultContent into schema
  if (cmssy.defaultContent) {
    Object.keys(cmssy.defaultContent).forEach((key) => {
      if (schema[key]) {
        schema[key].defaultValue = cmssy.defaultContent[key];
      }
    });
  }

  // Generate block.config.ts
  const configContent = generateBlockConfigContent(
    cmssy.displayName || pkg.name,
    pkg.description || cmssy.description || "",
    cmssy.longDescription,
    cmssy.category || (isTemplate ? "pages" : "other"),
    cmssy.tags || [],
    schema,
    cmssy.pricing || { licenseType: "free" },
    isTemplate
  );

  fs.writeFileSync(path.join(blockPath, "block.config.ts"), configContent);

  // Update package.json - remove cmssy section
  const newPkg = { ...pkg };
  delete newPkg.cmssy;

  fs.writeFileSync(
    path.join(blockPath, "package.json"),
    JSON.stringify(newPkg, null, 2) + "\n"
  );

  // Generate types
  await generateTypes(blockPath, schema);
}

function convertLegacySchemaToNew(
  schemaFields: any[]
): Record<string, FieldConfig> {
  const schema: Record<string, any> = {};

  schemaFields.forEach((field: any) => {
    const newField: any = {
      type: mapLegacyType(field.type),
      label: field.label,
      required: field.required || false,
    };

    if (field.placeholder) newField.placeholder = field.placeholder;
    if (field.helpText) newField.helpText = field.helpText;

    // Handle select fields
    if (field.type === "select" && field.options) {
      newField.options = field.options;
    }

    // Handle repeater fields
    if (field.type === "repeater" && field.itemSchema) {
      if (field.minItems) newField.minItems = field.minItems;
      if (field.maxItems) newField.maxItems = field.maxItems;

      if (field.itemSchema.fields) {
        newField.schema = convertLegacySchemaToNew(field.itemSchema.fields);
      } else {
        newField.schema = {};
      }
    }

    schema[field.key] = newField;
  });

  return schema;
}

function mapLegacyType(legacyType: string): string {
  // Map old type names to new ones
  const typeMap: Record<string, string> = {
    text: "singleLine",
    string: "singleLine",
    // Most other types stay the same
  };

  return typeMap[legacyType] || legacyType;
}

function generateBlockConfigContent(
  name: string,
  description: string,
  longDescription: string | undefined,
  category: string,
  tags: string[],
  schema: Record<string, any>,
  pricing: any,
  isTemplate: boolean
): string {
  const defineFunction = isTemplate ? "defineTemplate" : "defineBlock";

  // Format schema as code (not JSON)
  const schemaCode = formatSchemaAsCode(schema, 2);

  return `import { ${defineFunction} } from 'cmssy-cli/config';

export default ${defineFunction}({
  name: '${name.replace(/'/g, "\\'")}',
  description: '${description.replace(/'/g, "\\'")}',${
    longDescription ? `\n  longDescription: '${longDescription.replace(/'/g, "\\'")}',` : ""
  }
  category: '${category}',
  tags: ${JSON.stringify(tags)},

  schema: ${schemaCode},

  pricing: ${JSON.stringify(pricing)},
});
`;
}

function formatSchemaAsCode(schema: Record<string, any>, indent: number): string {
  const indentStr = "  ".repeat(indent);
  const lines: string[] = ["{"];

  Object.entries(schema).forEach(([key, field], index, arr) => {
    const fieldLines: string[] = [`${indentStr}${key}: {`];

    fieldLines.push(`${indentStr}  type: '${field.type}',`);
    fieldLines.push(`${indentStr}  label: '${field.label.replace(/'/g, "\\'")}',`);

    if (field.required) {
      fieldLines.push(`${indentStr}  required: true,`);
    }
    if (field.placeholder) {
      fieldLines.push(`${indentStr}  placeholder: '${field.placeholder.replace(/'/g, "\\'")}',`);
    }
    if (field.helpText) {
      fieldLines.push(`${indentStr}  helpText: '${field.helpText.replace(/'/g, "\\'")}',`);
    }
    if (field.defaultValue !== undefined) {
      fieldLines.push(
        `${indentStr}  defaultValue: ${JSON.stringify(field.defaultValue)},`
      );
    }

    // Handle select options
    if (field.options) {
      fieldLines.push(`${indentStr}  options: ${JSON.stringify(field.options)},`);
    }

    // Handle repeater schema
    if (field.schema) {
      if (field.minItems) {
        fieldLines.push(`${indentStr}  minItems: ${field.minItems},`);
      }
      if (field.maxItems) {
        fieldLines.push(`${indentStr}  maxItems: ${field.maxItems},`);
      }
      const nestedSchema = formatSchemaAsCode(field.schema, indent + 2);
      fieldLines.push(`${indentStr}  schema: ${nestedSchema},`);
    }

    fieldLines.push(`${indentStr}},${index < arr.length - 1 ? "" : ""}`);
    lines.push(...fieldLines);
  });

  lines.push(`${" ".repeat((indent - 1) * 2)}}`);
  return lines.join("\n");
}
