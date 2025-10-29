
@sessions/CLAUDE.sessions.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SonarQube for IDE (formerly SonarLint) is a VS Code extension that provides real-time code quality and security analysis. The extension uses a Java-based Language Server Protocol (LSP) implementation that communicates with multiple language analyzers.

## Architecture

### Core Components

**Extension Entry Point** (`src/extension.ts`)
- Main activation point for the VS Code extension
- Initializes language client, views, and command handlers
- Manages lifecycle of the language server

**Language Server Communication** (`src/lsp/`)
- `client.ts`: Extended LSP client (`SonarLintExtendedLanguageClient`) with custom methods for connection management, token validation, and rule retrieval
- `server.ts`: Language server startup configuration, constructs Java command with analyzers
- `protocol.ts`: Custom LSP protocol definitions for SonarQube-specific operations

**Connection Management** (`src/connected/`)
- `connections.ts`: Manages SonarQube Server and SonarQube Cloud connections
- `binding.ts`: Handles workspace folder binding to remote projects
- `connectionsetup.ts`: Connection creation and authentication wizards

**Findings System** (`src/findings/`)
- Tree data provider for displaying issues, hotspots, taint vulnerabilities, and dependency risks
- Different node types: `findingNode.ts`, `hotspotNode.ts`, `taintVulnerabilityNode.ts`, `dependencyRiskNode.ts`
- Supports filtering and grouping by file/folder

**Language Model Tools** (`src/languageModelTools/`)
- Integration with VS Code's language model API (Copilot, etc.)
- Tools: analyze file, list security issues, exclude files, setup connected mode
- Enables AI agents to interact with SonarQube analysis

**AI Agents Configuration** (`src/aiAgentsConfiguration/`)
- MCP (Model Context Protocol) server configuration
- Rule configuration for AI agents
- Enables Claude Code and other AI agents to use SonarQube data

### Build System

The extension uses **webpack** for bundling TypeScript code:
- Development: TypeScript compiled to `out/`, webpack bundles to `dist/extension.js`
- Production: webpack with minification and optional Sentry source map upload
- Language server JAR and analyzer JARs are downloaded during `prepare` step

### Language Analyzers

The extension bundles multiple SonarSource analyzers as JARs:
- JavaScript/TypeScript (sonarjs.jar)
- Java (sonarjava.jar, sonarjavasymbolicexecution.jar)
- Python (sonarpython.jar)
- PHP (sonarphp.jar)
- Go (sonargo.jar)
- C/C++ (sonarcfamily.jar - conditionally loaded)
- HTML (sonarhtml.jar)
- XML (sonarxml.jar)
- IaC/CloudFormation/Docker/Kubernetes (sonariac.jar)
- C#/.NET (sonarlintomnisharp.jar, sonarcsharp.jar)
- Text/secrets (sonartext.jar)

## Common Development Commands

### Setup and Build
```bash
# Install dependencies
npm install

# Download language server and analyzer JARs
npm run prepare
# OR (using the build script directly)
node build-sonarlint/prepare.mjs

# Compile TypeScript
npm run compile

# Build for development (webpack)
npm run webpack

# Build for production
npm run vscode:prepublish
```

### Testing
```bash
# Run all tests
npm test

# Run tests with coverage
npm test-cov

# Build before testing (includes webpack and TypeScript compilation)
npm run pretest
```

### Development Workflow
- Press `F5` in VS Code to launch Extension Development Host with the extension loaded
- Open **Problems** panel with `Ctrl+Shift+M` to see analysis results
- Use **SonarQube for IDE Output** channel for debugging (View → Output)

### Packaging
```bash
# Package single platform
npm run package

# Package all platforms
npm run package-all
```

## Key Configuration Files

- `package.json`: Extension manifest with contributions (commands, views, settings, language model tools)
- `tsconfig.json`: TypeScript configuration targeting ES6 with CommonJS modules
- `webpack.config.js`: Webpack bundling configuration with optional Sentry plugin
- `build-sonarlint/prepare.mjs`: Downloads JAR dependencies from Maven repositories

## Important Patterns

### Connected Mode vs Standalone Mode
- **Standalone**: Local-only analysis with user-configured rules
- **Connected Mode**: Syncs with SonarQube Server/Cloud for consistent team settings, quality profiles, and additional analysis (taint vulnerabilities, more languages)

### Views and Tree Data Providers
The extension provides several custom views:
- **Connected Mode**: Connection and binding management
- **Findings**: Issues, hotspots, taint vulnerabilities, dependency risks
- **Rules**: Browse and configure analysis rules
- **AI Agents Configuration**: MCP server setup for AI integration
- **Help and Feedback**: Links to documentation and support

### Language Model Tool Integration
The extension exposes tools to VS Code's language model API:
- Tools are defined in `package.json` under `languageModelTools`
- Implementations are in `src/languageModelTools/`
- Enables AI coding assistants to trigger analysis, query issues, and configure the extension

### Settings Scope
- `application`: Global settings (connections, rules)
- `resource`: Workspace-specific settings (project bindings, test file patterns)
- `machine`: Machine-specific settings (Java home, Node path)

## Testing

Tests are located in `test/suite/` and use Mocha framework:
- Unit tests for individual modules
- Integration tests run in VS Code test environment
- Coverage reports generated with Istanbul

## Language Server Details

The Java language server (`sonarlint-ls.jar`) runs as a separate process:
- Communicates via stdio using LSP
- Loads analyzer JARs dynamically
- Handles file analysis, rule management, and connection to remote servers
- Supports custom VM arguments via `sonarlint.ls.vmargs` setting

## External Dependencies

**Runtime Requirements:**
- Java 17+ (for language server)
- Node.js 20.12.0+ or 22.11.0+ (for JavaScript/TypeScript analysis)

**Key npm Dependencies:**
- `vscode-languageclient`: LSP client library
- `openpgp`: Signature verification for C/C++ analyzer
- `@sentry/node`: Error monitoring
- Various utilities: diff, tar, luxon, globby

## CI/CD

GitHub Actions workflows in `.github/workflows/`:
- `build.yml`: Main build and test pipeline
- `release.yml`: Publishing to VS Code Marketplace
- `shadow-scans.yml`: Internal quality checks
