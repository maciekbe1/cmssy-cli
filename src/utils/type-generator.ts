import fs from "fs-extra";
import path from "path";
import {
  FieldConfig,
  SelectFieldConfig,
  RepeaterFieldConfig,
} from "../types/block-config.js";

export async function generateTypes(
  blockPath: string,
  schema: Record<string, FieldConfig>
): Promise<void> {
  const typeDefinition = generateTypeDefinition(schema);
  const outputPath = path.join(blockPath, "src", "block.d.ts");

  const fileContent = `// Auto-generated from block.config.ts
// DO NOT EDIT - This file is automatically regenerated

export interface BlockContent {
${typeDefinition}
}
`;

  await fs.writeFile(outputPath, fileContent);
}

function generateTypeDefinition(
  schema: Record<string, FieldConfig>,
  indent = "  "
): string {
  const lines: string[] = [];

  Object.entries(schema).forEach(([key, field]) => {
    const optional = field.required ? "" : "?";
    const tsType = mapFieldTypeToTypeScript(field);

    if (field.helpText) {
      lines.push(`${indent}/** ${field.helpText} */`);
    }
    lines.push(`${indent}${key}${optional}: ${tsType};`);
  });

  return lines.join("\n");
}

function mapFieldTypeToTypeScript(field: FieldConfig): string {
  switch (field.type) {
    case "singleLine":
    case "multiLine":
    case "richText":
    case "text":
    case "string":
    case "link":
    case "color":
      return "string";

    case "number":
      return "number";

    case "boolean":
      return "boolean";

    case "date":
      return "string"; // ISO date string

    case "media":
      return "{ url: string; alt?: string; width?: number; height?: number }";

    case "select": {
      const selectField = field as SelectFieldConfig;
      if (selectField.options && selectField.options.length > 0) {
        const unionTypes = selectField.options
          .map((opt) => `"${opt.value}"`)
          .join(" | ");
        return unionTypes;
      }
      return "string";
    }

    case "repeater": {
      const repeaterField = field as RepeaterFieldConfig;
      if (repeaterField.schema) {
        const nestedType = `{\n${generateTypeDefinition(repeaterField.schema, "    ")}\n  }`;
        return `Array<${nestedType}>`;
      }
      return "any[]";
    }

    default:
      return "any";
  }
}
