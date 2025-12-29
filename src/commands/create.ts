import chalk from "chalk";
import fs from "fs-extra";
import inquirer from "inquirer";
import ora from "ora";
import path from "path";
import { loadConfig } from "../utils/blockforge-config.js";

async function createBlock(name: string) {
  const spinner = ora("Creating block...").start();

  try {
    // Load config
    const config = await loadConfig();
    const blockPath = path.join(process.cwd(), "blocks", name);

    // Check if block already exists
    if (fs.existsSync(blockPath)) {
      spinner.fail(`Block "${name}" already exists`);
      process.exit(1);
    }

    // Prompt for block details
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "displayName",
        message: "Display name:",
        default: name.charAt(0).toUpperCase() + name.slice(1),
      },
      {
        type: "input",
        name: "description",
        message: "Description:",
        default: "",
      },
      {
        type: "list",
        name: "category",
        message: "Category:",
        choices: [
          "marketing",
          "typography",
          "media",
          "layout",
          "forms",
          "navigation",
          "other",
        ],
        default: "marketing",
      },
      {
        type: "input",
        name: "tags",
        message: "Tags (comma-separated):",
        default: "",
        filter: (input) =>
          input
            .split(",")
            .map((tag: string) => tag.trim())
            .filter(Boolean),
      },
    ]);

    // Create directory structure
    fs.mkdirSync(path.join(blockPath, "src"), { recursive: true });

    // Create component file based on framework
    if (config.framework === "react") {
      const componentName = answers.displayName.replace(/\s+/g, "");
      const componentFile = `export default function ${componentName}({ content }) {
  const {
    heading = 'Heading',
    description = 'Description',
  } = content;

  return (
    <section className="${name}">
      <h2>{heading}</h2>
      <p>{description}</p>
    </section>
  );
}
`;
      fs.writeFileSync(
        path.join(blockPath, "src", `${componentName}.tsx`),
        componentFile
      );

      // Create index file with mount/unmount
      const indexFile = `import React from 'react';
import { createRoot } from 'react-dom/client';
import ${componentName} from './${componentName}';
import './index.css';

export default {
  mount(element, props) {
    const root = createRoot(element);
    root.render(<${componentName} content={props} />);
    return { root };
  },

  unmount(_element, ctx) {
    ctx.root.unmount();
  }
};
`;
      fs.writeFileSync(path.join(blockPath, "src", "index.tsx"), indexFile);
    }

    // Create CSS file
    const cssFile = `.${name} {
  padding: 2rem;
}

.${name} h2 {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.${name} p {
  font-size: 1rem;
  color: #666;
}
`;
    fs.writeFileSync(path.join(blockPath, "src", "index.css"), cssFile);

    // Create package.json
    const packageJson = {
      name: `@${config.projectName || "vendor"}/blocks.${name}`,
      version: "1.0.0",
      description: answers.description,
      author: config.author,
      blockforge: {
        packageType: "block",
        displayName: answers.displayName,
        category: answers.category,
        tags: answers.tags,
        pricing: {
          licenseType: "free",
        },
        schemaFields: [
          {
            key: "heading",
            type: "text",
            label: "Heading",
            required: true,
            placeholder: "Enter heading",
          },
          {
            key: "description",
            type: "text",
            label: "Description",
            placeholder: "Enter description",
          },
        ],
        defaultContent: {
          heading: "Heading",
          description: "Description",
        },
      },
    };

    fs.writeFileSync(
      path.join(blockPath, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n"
    );

    // Create preview.json
    const previewData = {
      heading: "Preview Heading",
      description: "This is how your block will look in the preview.",
    };

    fs.writeFileSync(
      path.join(blockPath, "preview.json"),
      JSON.stringify(previewData, null, 2) + "\n"
    );

    spinner.succeed(`Block "${name}" created successfully`);
    console.log(chalk.cyan("\nNext steps:\n"));
    console.log(chalk.white("  npm run dev       # Preview your block"));
    console.log(chalk.white("  npm run build     # Build your block\n"));
  } catch (error) {
    spinner.fail("Failed to create block");
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

async function createPage(name: string) {
  const spinner = ora("Creating page template...").start();

  try {
    const config = await loadConfig();
    const pagePath = path.join(process.cwd(), "templates", name);

    if (fs.existsSync(pagePath)) {
      spinner.fail(`Page template "${name}" already exists`);
      process.exit(1);
    }

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "displayName",
        message: "Display name:",
        default: name.charAt(0).toUpperCase() + name.slice(1),
      },
      {
        type: "input",
        name: "description",
        message: "Description:",
        default: "",
      },
    ]);

    fs.mkdirSync(path.join(pagePath, "src"), { recursive: true });

    if (config.framework === "react") {
      const componentName = answers.displayName.replace(/\s+/g, "");
      const componentFile = `export default function ${componentName}({ content }) {
  const {
    title = 'Page Title',
    sections = [],
  } = content;

  return (
    <div className="${name}-page">
      <header>
        <h1>{title}</h1>
      </header>
      <main>
        {sections.map((section, index) => (
          <div key={index} className="section">
            {/* Render blocks here */}
          </div>
        ))}
      </main>
    </div>
  );
}
`;
      fs.writeFileSync(
        path.join(pagePath, "src", `${componentName}.tsx`),
        componentFile
      );

      const indexFile = `import React from 'react';
import { createRoot } from 'react-dom/client';
import ${componentName} from './${componentName}';
import './index.css';

export default {
  mount(element, props) {
    const root = createRoot(element);
    root.render(<${componentName} content={props} />);
    return { root };
  },

  unmount(_element, ctx) {
    ctx.root.unmount();
  }
};
`;
      fs.writeFileSync(path.join(pagePath, "src", "index.tsx"), indexFile);
    }

    const cssFile = `.${name}-page {
  min-height: 100vh;
}

.${name}-page header {
  padding: 2rem;
  background: #f5f5f5;
}

.${name}-page h1 {
  font-size: 2.5rem;
  margin: 0;
}

.${name}-page main {
  padding: 2rem;
}

.section {
  margin-bottom: 2rem;
}
`;
    fs.writeFileSync(path.join(pagePath, "src", "index.css"), cssFile);

    const packageJson = {
      name: `@${config.projectName || "vendor"}/templates.${name}`,
      version: "1.0.0",
      description: answers.description,
      author: config.author,
      blockforge: {
        packageType: "template",
        displayName: answers.displayName,
        category: "pages",
        pricing: {
          licenseType: "free",
        },
        schemaFields: [
          {
            key: "title",
            type: "text",
            label: "Page Title",
            required: true,
            placeholder: "Enter page title",
          },
          {
            key: "sections",
            type: "array",
            label: "Page Sections",
            itemSchema: {
              type: "object",
            },
          },
        ],
        defaultContent: {
          title: "Page Title",
          sections: [],
        },
      },
    };

    fs.writeFileSync(
      path.join(pagePath, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n"
    );

    const previewData = {
      title: "Preview Page",
      sections: [],
    };

    fs.writeFileSync(
      path.join(pagePath, "preview.json"),
      JSON.stringify(previewData, null, 2) + "\n"
    );

    spinner.succeed(`Page template "${name}" created successfully`);
    console.log(chalk.cyan("\nNext steps:\n"));
    console.log(chalk.white("  npm run dev       # Preview your page"));
    console.log(chalk.white("  npm run build     # Build your page\n"));
  } catch (error) {
    spinner.fail("Failed to create page template");
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

export const createCommand = {
  block: createBlock,
  page: createPage,
};
