import { GraphQLClient } from "graphql-request";
import { loadConfig } from "./config.js";

export function createClient(): GraphQLClient {
  const config = loadConfig();

  if (!config.apiToken) {
    throw new Error(
      "CMSSY_API_TOKEN not configured. Run: cmssy configure"
    );
  }

  return new GraphQLClient(config.apiUrl, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    },
  });
}

// GraphQL Mutations
export const PUBLISH_PACKAGE_MUTATION = `
  mutation PublishPackage($token: String!, $input: PublishPackageInput!) {
    publishPackage(token: $token, input: $input) {
      success
      message
      packageId
      status
    }
  }
`;

export const IMPORT_BLOCK_MUTATION = `
  mutation ImportBlock($input: ImportBlockInput!) {
    importBlock(input: $input) {
      id
      blockType
      name
      description
      icon
      category
      sourceCode
      schemaFields {
        key
        type
        label
        defaultValue
        placeholder
        required
        helperText
        options
        minValue
        maxValue
      }
      defaultContent
      version
      createdAt
    }
  }
`;
