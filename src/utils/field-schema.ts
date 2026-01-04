import fs from "fs-extra";
import path from "path";
import { GraphQLClient } from "graphql-request";
import { hasConfig, loadConfig } from "./config.js";

export interface FieldTypeDefinition {
  type: string;
  label: string;
  description: string;
  allowsDefaultValue: boolean;
  supportsValidation: boolean;
}

const CACHE_FILE = ".cmssy/field-types.json";
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Fallback field types if backend is unreachable
const FALLBACK_FIELD_TYPES: FieldTypeDefinition[] = [
  {
    type: "singleLine",
    label: "Single Line Text",
    description: "Short text input",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "multiLine",
    label: "Multi-line Text",
    description: "Text area",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "richText",
    label: "Rich Text",
    description: "WYSIWYG editor",
    allowsDefaultValue: true,
    supportsValidation: false,
  },
  {
    type: "numeric",
    label: "Numeric",
    description: "Numeric input",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "toggle",
    label: "Toggle",
    description: "True/false toggle",
    allowsDefaultValue: true,
    supportsValidation: false,
  },
  {
    type: "date",
    label: "Date",
    description: "Date picker",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "media",
    label: "Media",
    description: "Image/video upload",
    allowsDefaultValue: false,
    supportsValidation: true,
  },
  {
    type: "link",
    label: "Link",
    description: "URL input",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "select",
    label: "Select",
    description: "Dropdown selection",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "multiselect",
    label: "Multi-select",
    description: "Multiple selection",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "color",
    label: "Color",
    description: "Color picker",
    allowsDefaultValue: true,
    supportsValidation: false,
  },
  {
    type: "slider",
    label: "Slider",
    description: "Range slider",
    allowsDefaultValue: true,
    supportsValidation: true,
  },
  {
    type: "repeater",
    label: "Repeater",
    description: "Repeatable nested fields",
    allowsDefaultValue: false,
    supportsValidation: true,
  },
];

export async function getFieldTypes(): Promise<FieldTypeDefinition[]> {
  // Check cache first
  const cached = await loadCachedFieldTypes();
  if (cached) return cached;

  // Try to fetch from backend via GraphQL if configured
  if (hasConfig()) {
    try {
      const config = loadConfig();
      const client = new GraphQLClient(config.apiUrl, {
        headers: config.apiToken
          ? { Authorization: `Bearer ${config.apiToken}` }
          : {},
      });

      const query = `
        query GetFieldTypes {
          fieldTypes {
            type
            label
            description
            allowsDefaultValue
            supportsValidation
          }
        }
      `;

      const data: any = await client.request(query);
      const fieldTypes = data.fieldTypes as FieldTypeDefinition[];
      await cacheFieldTypes(fieldTypes);
      return fieldTypes;
    } catch (error) {
      // Backend unreachable, use fallback
    }
  }

  return FALLBACK_FIELD_TYPES;
}

async function loadCachedFieldTypes(): Promise<FieldTypeDefinition[] | null> {
  const cachePath = path.join(process.cwd(), CACHE_FILE);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const cached = await fs.readJson(cachePath);
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_DURATION_MS) {
      return cached.fieldTypes;
    }
  } catch {
    // Invalid cache
  }

  return null;
}

async function cacheFieldTypes(
  fieldTypes: FieldTypeDefinition[]
): Promise<void> {
  const cachePath = path.join(process.cwd(), CACHE_FILE);
  fs.ensureDirSync(path.dirname(cachePath));
  await fs.writeJson(cachePath, {
    timestamp: Date.now(),
    fieldTypes,
  });
}

export function isValidFieldType(
  type: string,
  fieldTypes: FieldTypeDefinition[]
): boolean {
  return fieldTypes.some((ft) => ft.type === type);
}
