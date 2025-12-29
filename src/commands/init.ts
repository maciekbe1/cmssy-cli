import chalk from "chalk";
import { execSync } from "child_process";
import fs from "fs-extra";
import inquirer from "inquirer";
import ora from "ora";
import path from "path";

interface InitOptions {
  framework: string;
}

interface InitAnswers {
  projectName: string;
  framework: string;
  useTailwind: boolean;
  authorName: string;
  authorEmail: string;
  initGit: boolean;
}

export async function initCommand(name?: string, options?: InitOptions) {
  console.log(chalk.blue.bold("\n🔨 BlockForge - Initialize Project\n"));

  const answers = await inquirer.prompt<InitAnswers>([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: name || "my-blocks",
      validate: (input) => {
        if (/^[a-z0-9-_]+$/.test(input)) return true;
        return "Project name must contain only lowercase letters, numbers, hyphens, and underscores";
      },
    },
    {
      type: "list",
      name: "framework",
      message: "Framework:",
      choices: [
        { name: "React", value: "react" },
        { name: "Vue", value: "vue" },
        { name: "Angular", value: "angular" },
        { name: "Svelte", value: "svelte" },
        { name: "Vanilla JS", value: "vanilla" },
      ],
      default: options?.framework || "react",
    },
    {
      type: "confirm",
      name: "useTailwind",
      message: "Use Tailwind CSS v4?",
      default: true,
    },
    {
      type: "input",
      name: "authorName",
      message: "Author name:",
      default: "",
    },
    {
      type: "input",
      name: "authorEmail",
      message: "Author email:",
      default: "",
    },
    {
      type: "confirm",
      name: "initGit",
      message: "Initialize git repository?",
      default: true,
    },
  ]);

  const projectPath = path.join(process.cwd(), answers.projectName);

  // Check if directory exists
  if (fs.existsSync(projectPath)) {
    console.error(
      chalk.red(`\n✖ Directory "${answers.projectName}" already exists\n`)
    );
    process.exit(1);
  }

  const spinner = ora("Creating project structure...").start();

  try {
    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });

    // Create directory structure
    const dirs = ["blocks", "templates", "public", ".blockforge"];

    dirs.forEach((dir) => {
      fs.mkdirSync(path.join(projectPath, dir), { recursive: true });
    });

    // Create blockforge.config.js
    const config = {
      framework: answers.framework,
      author: {
        name: answers.authorName,
        email: answers.authorEmail,
      },
      cdn: {
        baseUrl: "",
      },
      build: {
        outDir: "public",
        minify: true,
        sourcemap: true,
      },
    };

    fs.writeFileSync(
      path.join(projectPath, "blockforge.config.js"),
      `export default ${JSON.stringify(config, null, 2)};\n`
    );

    // Create package.json
    const packageJson: any = {
      name: answers.projectName,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "cmssy-forge dev",
        build: "cmssy-forge build",
      },
      dependencies: {},
      devDependencies: {
        "cmssy-forge": "^0.2.0",
      },
    };

    // Add Tailwind CSS v4 if selected
    if (answers.useTailwind) {
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        tailwindcss: "^4.0.0",
        "@tailwindcss/postcss": "^4.0.0",
        postcss: "^8.4.49",
        "postcss-cli": "^11.0.0",
      };
    }

    // Add framework-specific dependencies
    if (answers.framework === "react") {
      packageJson.dependencies = {
        react: "^19.2.3",
        "react-dom": "^19.2.3",
      };
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        "@types/react": "^19.2.7",
        "@types/react-dom": "^19",
        typescript: "^5.7.2",
      };
    }

    fs.writeFileSync(
      path.join(projectPath, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n"
    );

    // Create tsconfig.json for React projects
    if (answers.framework === "react") {
      const tsConfig = {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          jsx: "react-jsx",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          forceConsistentCasingInFileNames: true,
        },
        include: ["blocks/**/*", "templates/**/*"],
        exclude: ["node_modules", "dist", "public"],
      };
      fs.writeFileSync(
        path.join(projectPath, "tsconfig.json"),
        JSON.stringify(tsConfig, null, 2) + "\n"
      );
    }

    // Create .gitignore
    const gitignore = `node_modules/
dist/
public/
.env
.DS_Store
*.log
.blockforge/cache/
`;
    fs.writeFileSync(path.join(projectPath, ".gitignore"), gitignore);

    // Create postcss.config.js for Tailwind v4 if selected
    if (answers.useTailwind) {
      const postcssConfig = `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`;
      fs.writeFileSync(path.join(projectPath, "postcss.config.js"), postcssConfig);
    }

    // Create .env.example
    const envExample = `# Cmssy API Configuration
# Run 'cmssy-forge configure' to set these values

# Cmssy GraphQL API URL
CMSSY_API_URL=https://api.cmssy.io/graphql

# Cmssy API Token (get from Workspace Settings → API Tokens)
# Required scopes: marketplace:publish
CMSSY_API_TOKEN=
`;
    fs.writeFileSync(path.join(projectPath, ".env.example"), envExample);

    // Create README.md
    const readme = `# ${answers.projectName}

Cmssy Forge project for building reusable UI blocks and templates.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server with hot reload
cmssy-forge dev -p 3000

# Create a new block
cmssy-forge create block my-block

# Build for production
cmssy-forge build
\`\`\`

## Available Commands

### Development
\`\`\`bash
# Start dev server with preview UI
cmssy-forge dev -p 3000

# Create a new block
cmssy-forge create block <name>

# Create a new page template
cmssy-forge create template <name>

# Build all blocks and templates
cmssy-forge build
\`\`\`

### Publishing to Cmssy Marketplace
\`\`\`bash
# Configure API credentials (run once)
cmssy-forge configure

# Deploy all blocks and templates
cmssy-forge deploy --all

# Deploy specific blocks
cmssy-forge deploy --blocks hero pricing

# Deploy specific templates
cmssy-forge deploy --templates landing

# Preview what would be deployed
cmssy-forge deploy --all --dry-run
\`\`\`

### Syncing from Marketplace
\`\`\`bash
# Pull a specific block from marketplace
cmssy-forge sync @vendor/blocks.hero --workspace YOUR_WORKSPACE_ID

# Pull all installed packages
cmssy-forge sync --workspace YOUR_WORKSPACE_ID
\`\`\`

## Project Structure

\`\`\`
${answers.projectName}/
├── blocks/              # Your UI blocks
│   └── hero/
│       ├── src/
│       │   ├── index.tsx
│       │   ├── Hero.tsx
│       │   └── index.css
│       ├── package.json
│       └── preview.json
├── templates/           # Your page templates
├── public/              # Build output
├── blockforge.config.js # Project configuration
├── .env                 # API credentials (created by configure)
└── .env.example         # API credentials template
\`\`\`

## Configuration

Edit \`blockforge.config.js\` to customize:
- Framework (${answers.framework})
- Author information
- Build settings

## Framework

- ${answers.framework}

## Author

- ${answers.authorName} ${answers.authorEmail ? `<${answers.authorEmail}>` : ""}

## Documentation

For more information, visit: https://cmssy.io/docs
`;
    fs.writeFileSync(path.join(projectPath, "README.md"), readme);

    spinner.succeed("Project structure created");

    // Create example block
    spinner.start("Creating example hero block...");

    const exampleBlockPath = path.join(projectPath, "blocks", "hero");
    fs.mkdirSync(exampleBlockPath, { recursive: true });
    fs.mkdirSync(path.join(exampleBlockPath, "src"), { recursive: true });

    if (answers.framework === "react") {
      // Create React example with or without Tailwind
      const heroComponent = answers.useTailwind
        ? `interface HeroContent {
  heading?: string;
  subheading?: string;
  ctaText?: string;
  ctaUrl?: string;
}

interface HeroProps {
  content: HeroContent;
}

export default function Hero({ content }: HeroProps) {
  const {
    heading = 'Welcome to Cmssy Forge',
    subheading = 'Build reusable UI blocks with any framework',
    ctaText = 'Get Started',
    ctaUrl = '#',
  } = content;

  return (
    <section className="flex items-center justify-center min-h-[400px] p-8 bg-gradient-to-br from-purple-600 to-purple-900 text-white text-center">
      <div className="max-w-3xl">
        <h1 className="text-5xl font-bold mb-4">{heading}</h1>
        <p className="text-xl mb-8 opacity-90">{subheading}</p>
        <a
          href={ctaUrl}
          className="inline-block px-8 py-4 bg-white text-purple-600 rounded-lg font-semibold hover:scale-105 transition-transform"
        >
          {ctaText}
        </a>
      </div>
    </section>
  );
}
`
        : `interface HeroContent {
  heading?: string;
  subheading?: string;
  ctaText?: string;
  ctaUrl?: string;
}

interface HeroProps {
  content: HeroContent;
}

export default function Hero({ content }: HeroProps) {
  const {
    heading = 'Welcome to Cmssy Forge',
    subheading = 'Build reusable UI blocks with any framework',
    ctaText = 'Get Started',
    ctaUrl = '#',
  } = content;

  return (
    <section className="hero">
      <div className="hero-content">
        <h1>{heading}</h1>
        <p>{subheading}</p>
        <a href={ctaUrl} className="cta-button">
          {ctaText}
        </a>
      </div>
    </section>
  );
}
`;
      fs.writeFileSync(
        path.join(exampleBlockPath, "src", "Hero.tsx"),
        heroComponent
      );

      const indexFile = `import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import Hero from './Hero';

interface BlockContext {
  root: Root;
}

export default {
  mount(element: HTMLElement, props: any): BlockContext {
    const root = createRoot(element);
    root.render(<Hero content={props} />);
    return { root };
  },

  unmount(_element: HTMLElement, ctx: BlockContext): void {
    ctx.root.unmount();
  }
};
`;
      fs.writeFileSync(
        path.join(exampleBlockPath, "src", "index.tsx"),
        indexFile
      );
    }

    const cssFile = answers.useTailwind
      ? `@import "tailwindcss";
`
      : `.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  text-align: center;
}

.hero-content h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
  font-weight: bold;
}

.hero-content p {
  font-size: 1.25rem;
  margin-bottom: 2rem;
  opacity: 0.9;
}

.cta-button {
  display: inline-block;
  padding: 1rem 2rem;
  background: white;
  color: #667eea;
  text-decoration: none;
  border-radius: 0.5rem;
  font-weight: 600;
  transition: transform 0.2s;
}

.cta-button:hover {
  transform: scale(1.05);
}
`;
    fs.writeFileSync(path.join(exampleBlockPath, "src", "index.css"), cssFile);

    // Create package.json for block
    const blockPackageJson = {
      name: `@${answers.projectName}/blocks.hero`,
      version: "1.0.0",
      description: "Hero section block",
      author: {
        name: answers.authorName,
        email: answers.authorEmail,
      },
      blockforge: {
        packageType: "block",
        displayName: "Hero Section",
        category: "marketing",
        tags: ["hero", "landing", "cta"],
        pricing: {
          licenseType: "free",
        },
        schemaFields: [
          {
            key: "heading",
            type: "text",
            label: "Main Heading",
            required: true,
            placeholder: "Welcome to BlockForge",
          },
          {
            key: "subheading",
            type: "text",
            label: "Subheading",
            placeholder: "Build reusable UI blocks",
          },
          {
            key: "ctaText",
            type: "string",
            label: "CTA Button Text",
            placeholder: "Get Started",
          },
          {
            key: "ctaUrl",
            type: "link",
            label: "CTA Button URL",
            placeholder: "#",
          },
        ],
        defaultContent: {
          heading: "Welcome to BlockForge",
          subheading: "Build reusable UI blocks with any framework",
          ctaText: "Get Started",
          ctaUrl: "#",
        },
      },
    };

    fs.writeFileSync(
      path.join(exampleBlockPath, "package.json"),
      JSON.stringify(blockPackageJson, null, 2) + "\n"
    );

    // Create preview.json for dev server
    const previewData = {
      heading: "Welcome to BlockForge",
      subheading: "Build reusable UI blocks with any framework",
      ctaText: "Get Started",
      ctaUrl: "#",
    };

    fs.writeFileSync(
      path.join(exampleBlockPath, "preview.json"),
      JSON.stringify(previewData, null, 2) + "\n"
    );

    spinner.succeed("Example hero block created");

    // Initialize git
    if (answers.initGit) {
      spinner.start("Initializing git repository...");
      process.chdir(projectPath);
      execSync("git init", { stdio: "ignore" });
      execSync("git branch -m main", { stdio: "ignore" });
      spinner.succeed("Git repository initialized");
    }

    // Success message
    console.log(chalk.green.bold("\n✓ Project created successfully!\n"));
    console.log(chalk.cyan("Next steps:\n"));
    console.log(chalk.white(`  cd ${answers.projectName}`));
    console.log(chalk.white("  npm install"));
    console.log(chalk.white("  npm run dev"));
    console.log(chalk.gray("\nHappy building! 🔨\n"));
  } catch (error) {
    spinner.fail("Failed to create project");
    console.error(chalk.red("\nError:"), error);
    process.exit(1);
  }
}
