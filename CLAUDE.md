
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

**Proxy Configuration** (`src/util/proxy.ts`)
- Centralized proxy configuration utilities for corporate network environments
- Reads VS Code's `http.proxy`, `http.proxyStrictSSL`, `http.noProxy` settings
- Provides proxy agent for Node.js/TypeScript network operations
- Generates Java system properties for Language Server proxy support
- Secure credential handling via environment variables

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

## Proxy Support

The extension provides comprehensive proxy support for corporate network environments, operating at two layers:

### Architecture

**Dual-Layer Proxy Configuration:**
- **Node.js/TypeScript Layer**: Handles extension-level network operations (JRE downloads, C/C++ analyzer downloads)
- **Java Language Server Layer**: Handles language server network operations (SonarQube Server/Cloud connections, analyzer updates)

**Configuration Flow:**
1. Extension reads VS Code settings: `http.proxy`, `http.proxyStrictSSL`, `http.noProxy`, `http.proxySupport`
2. `src/util/proxy.ts` parses and validates proxy URL
3. For Node.js operations: Creates `HttpsProxyAgent` instance
4. For Java operations: Generates JVM system properties (`-Dhttp.proxyHost`, etc.)
5. Credentials passed securely via `JAVA_TOOL_OPTIONS` environment variable

### Integration Points

**Language Server Startup** (`src/lsp/server.ts`, lines 20-82):
- Calls `getProxyConfig()` to read VS Code settings
- Injects proxy JVM arguments via `getProxyJavaArgs()` (non-sensitive properties)
- Passes proxy credentials via `getProxyJavaEnv()` in environment variables
- Avoids duplicating user-specified proxy settings in `sonarlint.ls.vmargs`

**Extension Initialization** (`src/extension.ts`, lines 116-139):
- `runJavaServer()` function spawns Java process with proxy environment variables
- Ensures child process inherits proxy configuration from extension

**JRE Downloads** (`src/java/jre.ts`, lines 72-119):
- `download()` function uses `getProxyAgent()` for HTTPS requests
- Proxy agent handles authentication and SSL verification
- Enhanced error messages for proxy authentication failures

**C/C++ Analyzer Downloads** (`src/cfamily/ondemand.ts`, lines 44-139):
- `startDownloadAsync()` uses `getProxyAgent()` for analyzer JAR downloads
- Supports cancellation and progress reporting through proxy
- User-friendly error messages for proxy issues

### Security Considerations

**Credential Protection:**
- Proxy credentials are **never** passed as JVM command-line arguments
- Credentials are passed via `JAVA_TOOL_OPTIONS` environment variable to prevent exposure in process listings
- Node.js proxy agent handles credentials internally without logging

**Configuration Validation:**
- Invalid proxy URLs trigger user-friendly error notifications with link to settings
- Parsing errors are caught and logged without crashing the extension

### Protocol Support

**HTTP/HTTPS Proxies:**
- Fully supported in both Node.js and Java layers
- Default protocol when not specified
- Handles both HTTP and HTTPS target URLs

**SOCKS Proxies (SOCKS/SOCKS4/SOCKS5):**
- Supported in Java Language Server layer (via JVM system properties)
- **Not supported** in Node.js layer (JRE downloads, extension operations)
- Users needing full SOCKS support should use an HTTP proxy that forwards to SOCKS

**NoProxy Configuration:**
- VS Code setting: Array of patterns (e.g., `["*.internal.com", "localhost"]`)
- Converted to Java format: Pipe-separated string (e.g., `*.internal.com|localhost`)
- Supports wildcards: `*.example.com`, `.example.com`, exact matches

### Testing Proxy Configuration

To verify proxy configuration is working:
1. Set `http.proxy` in VS Code settings
2. Enable verbose logging: `sonarlint.output.showVerboseLogs`
3. Check SonarQube for IDE Output channel for proxy-related log messages
4. Test connection to SonarQube Server/Cloud in Connected Mode view

## External Dependencies

**Runtime Requirements:**
- Java 17+ (for language server)
- Node.js 20.12.0+ or 22.11.0+ (for JavaScript/TypeScript analysis)

**Key npm Dependencies:**
- `vscode-languageclient`: LSP client library
- `https-proxy-agent`: Proxy support for Node.js HTTPS requests
- `openpgp`: Signature verification for C/C++ analyzer
- `@sentry/node`: Error monitoring
- Various utilities: diff, tar, luxon, globby

## CI/CD

GitHub Actions workflows in `.github/workflows/`:
- `build.yml`: Main build and test pipeline
- `release.yml`: Publishing to VS Code Marketplace
- `shadow-scans.yml`: Internal quality checks
