import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';

interface InitOptions {
  framework: string;
}

interface InitAnswers {
  projectName: string;
  framework: string;
  authorName: string;
  authorEmail: string;
  initGit: boolean;
}

export async function initCommand(name?: string, options?: InitOptions) {
  console.log(chalk.blue.bold('\n🔨 BlockForge - Initialize Project\n'));

  const answers = await inquirer.prompt<InitAnswers>([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: name || 'my-blocks',
      validate: (input) => {
        if (/^[a-z0-9-_]+$/.test(input)) return true;
        return 'Project name must contain only lowercase letters, numbers, hyphens, and underscores';
      },
    },
    {
      type: 'list',
      name: 'framework',
      message: 'Framework:',
      choices: [
        { name: 'React', value: 'react' },
        { name: 'Vue', value: 'vue' },
        { name: 'Angular', value: 'angular' },
        { name: 'Svelte', value: 'svelte' },
        { name: 'Vanilla JS', value: 'vanilla' },
      ],
      default: options?.framework || 'react',
    },
    {
      type: 'input',
      name: 'authorName',
      message: 'Author name:',
      default: '',
    },
    {
      type: 'input',
      name: 'authorEmail',
      message: 'Author email:',
      default: '',
    },
    {
      type: 'confirm',
      name: 'initGit',
      message: 'Initialize git repository?',
      default: true,
    },
  ]);

  const projectPath = path.join(process.cwd(), answers.projectName);

  // Check if directory exists
  if (fs.existsSync(projectPath)) {
    console.error(chalk.red(`\n✖ Directory "${answers.projectName}" already exists\n`));
    process.exit(1);
  }

  const spinner = ora('Creating project structure...').start();

  try {
    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });

    // Create directory structure
    const dirs = [
      'blocks',
      'templates',
      'public',
      '.blockforge',
    ];

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
        baseUrl: '',
      },
      build: {
        outDir: 'public',
        minify: true,
        sourcemap: true,
      },
    };

    fs.writeFileSync(
      path.join(projectPath, 'blockforge.config.js'),
      `export default ${JSON.stringify(config, null, 2)};\n`
    );

    // Create package.json
    const packageJson: any = {
      name: answers.projectName,
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'cmssy-forge dev',
        build: 'cmssy-forge build',
      },
      dependencies: {},
      devDependencies: {
        'cmssy-forge': '^0.2.0',
      },
    };

    // Add framework-specific dependencies
    if (answers.framework === 'react') {
      packageJson.dependencies = {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      };
      packageJson.devDependencies = {
        ...packageJson.devDependencies,
        '@types/react': '^18.3.12',
        '@types/react-dom': '^18.3.1',
        typescript: '^5.7.2',
      };
    }

    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n'
    );

    // Create tsconfig.json for React projects
    if (answers.framework === 'react') {
      const tsConfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          jsx: 'react-jsx',
          moduleResolution: 'bundler',
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
        include: ['blocks/**/*', 'templates/**/*'],
        exclude: ['node_modules', 'dist', 'public'],
      };
      fs.writeFileSync(
        path.join(projectPath, 'tsconfig.json'),
        JSON.stringify(tsConfig, null, 2) + '\n'
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
    fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore);

    // Create README.md
    const readme = `# ${answers.projectName}

BlockForge project for building reusable UI blocks and templates.

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Create a new block
npx blockforge create block my-block

# Build for production
npm run build
\`\`\`

## Framework

- ${answers.framework}

## Author

- ${answers.authorName} ${answers.authorEmail ? `<${answers.authorEmail}>` : ''}
`;
    fs.writeFileSync(path.join(projectPath, 'README.md'), readme);

    spinner.succeed('Project structure created');

    // Create example block
    spinner.start('Creating example hero block...');

    const exampleBlockPath = path.join(projectPath, 'blocks', 'hero');
    fs.mkdirSync(exampleBlockPath, { recursive: true });
    fs.mkdirSync(path.join(exampleBlockPath, 'src'), { recursive: true });

    if (answers.framework === 'react') {
      // Create React example
      const heroComponent = `interface HeroContent {
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
    heading = 'Welcome to BlockForge',
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
      fs.writeFileSync(path.join(exampleBlockPath, 'src', 'Hero.tsx'), heroComponent);

      const indexFile = `import React from 'react';
import { createRoot } from 'react-dom/client';
import Hero from './Hero';
import './index.css';

export default {
  mount(element, props) {
    const root = createRoot(element);
    root.render(<Hero content={props} />);
    return { root };
  },

  unmount(_element, ctx) {
    ctx.root.unmount();
  }
};
`;
      fs.writeFileSync(path.join(exampleBlockPath, 'src', 'index.tsx'), indexFile);
    }

    const cssFile = `.hero {
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
    fs.writeFileSync(path.join(exampleBlockPath, 'src', 'index.css'), cssFile);

    // Create package.json for block
    const blockPackageJson = {
      name: `@${answers.projectName}/blocks.hero`,
      version: '1.0.0',
      description: 'Hero section block',
      author: {
        name: answers.authorName,
        email: answers.authorEmail,
      },
      blockforge: {
        packageType: 'block',
        displayName: 'Hero Section',
        category: 'marketing',
        tags: ['hero', 'landing', 'cta'],
        pricing: {
          licenseType: 'free',
        },
        schemaFields: [
          {
            key: 'heading',
            type: 'text',
            label: 'Main Heading',
            required: true,
            placeholder: 'Welcome to BlockForge',
          },
          {
            key: 'subheading',
            type: 'text',
            label: 'Subheading',
            placeholder: 'Build reusable UI blocks',
          },
          {
            key: 'ctaText',
            type: 'string',
            label: 'CTA Button Text',
            placeholder: 'Get Started',
          },
          {
            key: 'ctaUrl',
            type: 'link',
            label: 'CTA Button URL',
            placeholder: '#',
          },
        ],
        defaultContent: {
          heading: 'Welcome to BlockForge',
          subheading: 'Build reusable UI blocks with any framework',
          ctaText: 'Get Started',
          ctaUrl: '#',
        },
      },
    };

    fs.writeFileSync(
      path.join(exampleBlockPath, 'package.json'),
      JSON.stringify(blockPackageJson, null, 2) + '\n'
    );

    // Create preview.json for dev server
    const previewData = {
      heading: 'Welcome to BlockForge',
      subheading: 'Build reusable UI blocks with any framework',
      ctaText: 'Get Started',
      ctaUrl: '#',
    };

    fs.writeFileSync(
      path.join(exampleBlockPath, 'preview.json'),
      JSON.stringify(previewData, null, 2) + '\n'
    );

    spinner.succeed('Example hero block created');

    // Initialize git
    if (answers.initGit) {
      spinner.start('Initializing git repository...');
      process.chdir(projectPath);
      execSync('git init', { stdio: 'ignore' });
      execSync('git branch -m main', { stdio: 'ignore' });
      spinner.succeed('Git repository initialized');
    }

    // Success message
    console.log(chalk.green.bold('\n✓ Project created successfully!\n'));
    console.log(chalk.cyan('Next steps:\n'));
    console.log(chalk.white(`  cd ${answers.projectName}`));
    console.log(chalk.white('  npm install'));
    console.log(chalk.white('  npm run dev'));
    console.log(chalk.gray('\nHappy building! 🔨\n'));

  } catch (error) {
    spinner.fail('Failed to create project');
    console.error(chalk.red('\nError:'), error);
    process.exit(1);
  }
}
