---
name: m-implement-proxy-support
branch: feature/m-implement-proxy-support
status: pending
created: 2025-10-28
---

# Implement Proxy Support

## Problem/Goal
Add HTTP/HTTPS proxy support to the SonarLint VS Code extension to enable usage in corporate environments with network proxies. Users should be able to configure proxy settings and the extension should respect these settings for all network communication (LSP server connections, SonarQube Server/Cloud connections, analyzer downloads, etc.).

## Success Criteria
- [ ] Extension respects VS Code's built-in proxy settings (`http.proxy`, `http.proxyStrictSSL`, `http.proxyAuthorization`)
- [ ] Java language server properly inherits proxy configuration via JVM arguments
- [ ] All network operations work through configured proxy (LSP, SonarQube connections, JAR downloads)
- [ ] Proxy authentication is supported (basic auth via configuration)
- [ ] Extension handles proxy connection failures gracefully with clear error messages
- [ ] Documentation updated to explain proxy configuration options

## Context Manifest

### How Network Communication Currently Works

The SonarLint VS Code extension performs network communication in three distinct layers, each requiring proxy configuration:

#### 1. Extension TypeScript Layer (Node.js fetch API)

**JAR Download During Build (`build-sonarlint/prepare.mjs` and `artifactory.mjs`):**

When the extension is being built or prepared, it downloads language analyzer JARs and the language server JAR from Maven repositories. This happens in two scenarios:
- During `npm run prepare` (pre-installation build step)
- Optionally from SonarSource internal Artifactory (if credentials provided) or Maven Central

The download mechanism uses the **global `fetch()` API** (Node.js 18+ built-in):

```javascript
// artifactory.mjs - lines 25-31
const authenticatedFetch = url => fetch(url, {
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.pass}`).toString('base64')
  }
});
const maybeAuthenticatedFetch = credentialsDefined ? authenticatedFetch : fetch;
```

The `prepare.mjs` file (line 89) calls `artifactory.maybeAuthenticatedFetch()` to download JARs by:
1. First fetching `.sha1` checksum files
2. Comparing with local file checksums
3. Downloading the actual JAR if checksum mismatches or file doesn't exist

**Problem**: The Node.js `fetch()` API does **NOT** automatically respect proxy settings. It requires explicit configuration via custom agents.

**JRE Download at Runtime (`src/java/jre.ts`):**

When users choose to let SonarLint download a managed JRE, the extension uses the `follow-redirects` library:

```typescript
// jre.ts - lines 8-13, 85-97
import * as followRedirects from 'follow-redirects';
const https = followRedirects.https;

https.get(fileToDownload, res => {
  const fileToSave = fs.createWriteStream(jreZipPath);
  res.pipe(fileToSave);
  // ...
})
```

The `follow-redirects` library is a wrapper around Node's `http`/`https` modules. It **does** support proxy configuration through:
- Environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`)
- Custom agent configuration passed to `https.get(url, { agent: proxyAgent })`

**Current State**: The JRE download might partially work with environment variables, but there's no explicit proxy configuration from VS Code settings.

**Other Build-Time Downloads (`build-sonarlint/jreDownload.mjs`, `downloadUtil.mjs`):**

The build scripts also download JREs during packaging using `fetch()`:

```javascript
// jreDownload.mjs - line 50
fetch(manifestUrl).then(response => { /* ... */ })

// downloadUtil.mjs - line 16
const maybeAuthenticatedFetch = useAuthentication ? artifactory.maybeAuthenticatedFetch : fetch;
```

Same issue: `fetch()` doesn't honor proxies without explicit configuration.

#### 2. Language Server Protocol Communication (stdio-based)

**LSP Client/Server Architecture:**

The extension spawns the Java language server as a separate process and communicates via stdin/stdout (not network sockets):

```typescript
// extension.ts - lines 116-139
async function runJavaServer(context: VSCode.ExtensionContext): Promise<StreamInfo> {
  const requirements = await resolveRequirements(context);
  const { command, args } = await languageServerCommand(context, requirements);
  const process = ChildProcess.spawn(command, args);
  return {
    reader: process.stdout,
    writer: process.stdin
  }
}
```

The Java process is launched via `languageServerCommand()` in `src/lsp/server.ts`:

```typescript
// server.ts - lines 19-56
export async function languageServerCommand(context, requirements) {
  const serverJar = Path.resolve(context.extensionPath, 'server', 'sonarlint-ls.jar');
  const javaExecutablePath = Path.resolve(requirements.javaHome, 'bin', 'java');

  const params = [];
  // Debug flags in dev mode
  if (DEBUG) {
    params.push('-agentlib:jdwp=...');
  }

  // User-provided VM arguments
  const vmargs = sonarLintConfiguration.get('ls.vmargs', '');
  parseVMargs(params, vmargs);

  // Flight recorder flag
  if (sonarLintConfiguration.get('startFlightRecorder', false)) {
    params.push('-Dsonarlint.flightrecorder.enabled=true');
  }

  params.push('-jar', serverJar);
  params.push('-stdio');
  params.push('-analyzers', ...analyzerJars);

  return { command: javaExecutablePath, args: params };
}
```

**Key Insight**: The `ls.vmargs` setting allows users to pass arbitrary JVM arguments. This is the **critical integration point** for Java proxy configuration.

**Problem**: Currently, users would need to manually add proxy JVM args like:
```
-Dhttp.proxyHost=proxy.company.com -Dhttp.proxyPort=8080 -Dhttps.proxyHost=proxy.company.com -Dhttps.proxyPort=8080
```

There's no automatic mechanism to inject these from VS Code's proxy settings.

#### 3. Java Language Server HTTP Connections

The Java language server (running in the spawned JVM process) makes HTTP/HTTPS requests to:
- **SonarQube Server instances** - for connected mode project bindings, quality profiles, issue sync
- **SonarQube Cloud** - same as above, but to sonarcloud.io or sonarqube.us
- **Token generation endpoints** - automatic token creation flows
- **Project listing APIs** - fetching available projects for binding

The language server is a black box from the extension's perspective, but we know it's written in Java and likely uses standard Java HTTP clients (possibly Apache HttpClient, OkHttp, or java.net.http).

**Java Proxy Configuration**:
Java applications respect these system properties:
- `http.proxyHost` - HTTP proxy hostname
- `http.proxyPort` - HTTP proxy port (default: 80)
- `http.nonProxyHosts` - pipe-separated list of hosts to exclude from proxying
- `https.proxyHost` - HTTPS proxy hostname
- `https.proxyPort` - HTTPS proxy port (default: 443)
- `http.proxyUser` / `http.proxyPassword` - Basic authentication (if supported by the HTTP client library)
- `java.net.useSystemProxies=true` - Use OS-level proxy settings (Windows/macOS/GNOME)

**Current State**: The language server gets no proxy configuration automatically.

### VS Code Proxy Settings API

VS Code provides built-in proxy configuration settings that extensions **should** respect:

**Configuration Keys** (from VS Code's built-in settings):
- `http.proxy` - Proxy URL (e.g., `http://proxy.company.com:8080`)
- `http.proxyStrictSSL` - Whether to verify SSL certificates (default: true)
- `http.proxyAuthorization` - Proxy authorization header value (for auth)
- `http.noProxy` - Array of hosts to bypass proxy (not comma-separated, but array)

**Reading Settings in Extension**:
```typescript
const proxyConfig = vscode.workspace.getConfiguration('http');
const proxyUrl = proxyConfig.get<string>('proxy');
const strictSSL = proxyConfig.get<boolean>('proxyStrictSSL', true);
const proxyAuth = proxyConfig.get<string>('proxyAuthorization');
const noProxy = proxyConfig.get<string[]>('noProxy', []);
```

**Proxy URL Format**:
- Can be HTTP or HTTPS proxy URL: `http://proxy.example.com:8080`
- May include credentials: `http://user:pass@proxy.example.com:8080`
- Empty string means no proxy

**Important**: VS Code settings are **application-scoped** (global) for proxy settings, not workspace-specific.

### Where Proxy Configuration Needs to Be Applied

#### Integration Point 1: Java Language Server Startup (PRIMARY)

**Location**: `src/lsp/server.ts` in `languageServerCommand()` function

**Current Flow**:
1. Read `sonarlint.ls.vmargs` setting (line 34)
2. Parse VM args using `parseVMargs()` (line 35)
3. Append to Java command params

**Required Change**:
Before launching the Java process, inject proxy-related JVM system properties:

```typescript
// Pseudo-code for new function
function buildProxyVMArgs(): string[] {
  const proxyConfig = vscode.workspace.getConfiguration('http');
  const proxyUrl = proxyConfig.get<string>('proxy');

  if (!proxyUrl) {
    return [];
  }

  const parsed = parseProxyUrl(proxyUrl); // Need to implement URL parsing
  const args = [];

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    args.push(`-Dhttp.proxyHost=${parsed.hostname}`);
    args.push(`-Dhttp.proxyPort=${parsed.port || 80}`);
    args.push(`-Dhttps.proxyHost=${parsed.hostname}`);
    args.push(`-Dhttps.proxyPort=${parsed.port || 443}`);

    // Handle authentication
    if (parsed.username) {
      args.push(`-Dhttp.proxyUser=${parsed.username}`);
      args.push(`-Dhttps.proxyUser=${parsed.username}`);
    }
    if (parsed.password) {
      args.push(`-Dhttp.proxyPassword=${parsed.password}`);
      args.push(`-Dhttps.proxyPassword=${parsed.password}`);
    }
  }

  // Handle noProxy
  const noProxy = proxyConfig.get<string[]>('noProxy', []);
  if (noProxy.length > 0) {
    args.push(`-Dhttp.nonProxyHosts=${noProxy.join('|')}`);
  }

  return args;
}
```

**Integration**:
```typescript
// In languageServerCommand():
const vmargs = sonarLintConfiguration.get('ls.vmargs', '');
parseVMargs(params, vmargs);

// ADD AFTER:
const proxyArgs = buildProxyVMArgs();
params.push(...proxyArgs);
```

**Important Considerations**:
- User-provided `ls.vmargs` should take precedence (don't override if user explicitly set proxy args)
- Need to detect if proxy args already exist in `vmargs`
- URL parsing must handle authentication credentials securely
- Empty `http.proxy` means explicit no-proxy (don't use OS defaults)

#### Integration Point 2: Node.js fetch() Calls (Build-Time & Runtime)

**Affected Files**:
- `build-sonarlint/artifactory.mjs` - JAR downloads
- `build-sonarlint/prepare.mjs` - Checksum verification and downloads
- `build-sonarlint/downloadUtil.mjs` - File download utility
- `build-sonarlint/jreDownload.mjs` - JRE manifest and binary downloads

**Problem**: Node.js `fetch()` doesn't auto-detect proxies. Need to use proxy agents.

**Solution Pattern**:

Install proxy agent libraries:
```json
// package.json dependencies
{
  "http-proxy-agent": "^7.0.0",
  "https-proxy-agent": "^7.0.0"
}
```

Create proxy-aware fetch wrapper:
```typescript
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

function createProxyAgent(proxyUrl: string, targetUrl: string) {
  const isHttpsTarget = targetUrl.startsWith('https:');
  if (isHttpsTarget) {
    return new HttpsProxyAgent(proxyUrl);
  } else {
    return new HttpProxyAgent(proxyUrl);
  }
}

function fetchWithProxy(url: string, options: RequestInit = {}) {
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;

  if (proxyUrl) {
    const agent = createProxyAgent(proxyUrl, url);
    return fetch(url, { ...options, dispatcher: agent }); // Node 18+
  }

  return fetch(url, options);
}
```

**For Build Scripts (`.mjs` files)**:
Build-time downloads can't read VS Code settings (they run in Node.js without VS Code context). They should:
1. Honor environment variables: `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`
2. Document that developers need to set these for corporate proxy environments
3. Optionally read from `.npmrc` proxy settings

**For Runtime Downloads (`src/java/jre.ts`)**:
The JRE download uses `follow-redirects` library which supports agents:

```typescript
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

function download(options, destinationDir) {
  const fileToDownload = buildUrl(options);

  // Get VS Code proxy settings
  const proxyUrl = vscode.workspace.getConfiguration('http').get<string>('proxy');
  let requestOptions: any = {};

  if (proxyUrl) {
    requestOptions.agent = new HttpsProxyAgent(proxyUrl);
  }

  return new Promise((resolve, reject) => {
    https.get(fileToDownload, requestOptions, res => {
      // existing code
    });
  });
}
```

#### Integration Point 3: Configuration Management

**Location**: Create new utility module `src/util/proxy.ts`

**Purpose**: Centralize proxy configuration logic

**Module Interface**:
```typescript
export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https';
  noProxy: string[];
  strictSSL: boolean;
}

export function getProxyConfig(): ProxyConfig | null {
  // Read from vscode.workspace.getConfiguration('http')
  // Parse proxy URL
  // Return structured config or null if no proxy
}

export function getProxyJavaArgs(): string[] {
  // Convert ProxyConfig to Java system properties
  // Return array of -D arguments
}

export function getProxyAgent(targetUrl: string): any {
  // Return HttpProxyAgent or HttpsProxyAgent for fetch()
  // Return null if no proxy configured
}

export function isProxiedUrl(url: string, noProxy: string[]): boolean {
  // Check if URL should bypass proxy based on noProxy list
  // Handle wildcards: *.company.com
}
```

### Patterns and Conventions in the Codebase

**Configuration Reading Pattern**:
```typescript
// settings.ts shows the pattern
export function getSonarLintConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('sonarlint');
}

const vmargs = sonarLintConfiguration.get('ls.vmargs', '');
```

Extensions read VS Code settings via `workspace.getConfiguration()` and provide defaults.

**VM Args Parsing Pattern**:
```typescript
// server.ts - lines 59-78
export function parseVMargs(params: string[], vmargsLine: string) {
  if (!vmargsLine) return;

  // Regex to match quoted and unquoted arguments
  const vmargs = vmargsLine.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!vmargs) return;

  vmargs.forEach(arg => {
    // Remove standalone quotes, unescape escaped quotes
    arg = arg.replace(/(\\)?"/g, ($0, $1) => $1 ? $0 : '');
    arg = arg.replace(/(\\)"/g, '"');

    // Only add if not duplicate
    if (params.indexOf(arg) < 0) {
      params.push(arg);
    }
  });
}
```

This existing function prevents duplicates. Need to check if proxy args already exist before injecting.

**Settings Change Detection Pattern**:
```typescript
// settings.ts - lines 62-64
function hasSonarLintLsConfigChanged(oldConfig, newConfig) {
  return !configKeyEquals('ls.javaHome', oldConfig, newConfig)
      || !configKeyEquals('ls.vmargs', oldConfig, newConfig);
}
```

When `ls.javaHome` or `ls.vmargs` changes, extension prompts for restart. Proxy settings (`http.proxy`) should also trigger restart prompt since they affect language server startup.

**Error Handling Pattern**:
```typescript
// extension.ts - lines 130-138
try {
  // risky operation
} catch (error) {
  VSCode.window.showErrorMessage(error.message, error.label).then(selection => {
    if (error.label && error.label === selection && error.command) {
      VSCode.commands.executeCommand(error.command, error.commandParam);
    }
  });
  throw error; // rethrow to disrupt activation
}
```

Proxy connection failures should show informative error messages with actionable buttons (e.g., "Open Proxy Settings").

### Technical Details for Implementation

**Node.js Proxy Agent Libraries**:

Modern Node.js (18+) uses undici for `fetch()`. Proxy configuration requires:
```bash
npm install http-proxy-agent https-proxy-agent
```

**Usage with fetch()**:
```javascript
import { HttpsProxyAgent } from 'https-proxy-agent';

const agent = new HttpsProxyAgent('http://proxy.company.com:8080');
fetch('https://api.example.com', { dispatcher: agent }); // Node 18+
```

**For follow-redirects library**:
```javascript
https.get(url, { agent: new HttpsProxyAgent(proxyUrl) }, res => { ... });
```

**Java Proxy System Properties**:

Full list of relevant properties:
```
-Dhttp.proxyHost=proxy.example.com
-Dhttp.proxyPort=8080
-Dhttps.proxyHost=proxy.example.com
-Dhttps.proxyPort=8080
-Dhttp.proxyUser=username
-Dhttp.proxyPassword=password
-Dhttps.proxyUser=username
-Dhttps.proxyPassword=password
-Dhttp.nonProxyHosts=localhost|127.*|*.local
-Djava.net.useSystemProxies=false  // Disable OS proxy detection
```

**Security Consideration**: Proxy credentials in JVM args are visible in process lists. VS Code's `http.proxyAuthorization` is also not encrypted in settings. This is a known limitation - document in release notes.

**URL Parsing**:
```typescript
import { URL } from 'url';

function parseProxyUrl(proxyString: string) {
  try {
    const url = new URL(proxyString);
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password)
    };
  } catch (e) {
    // Invalid URL - log error and return null
    return null;
  }
}
```

**NoProxy Pattern Matching**:
VS Code's `http.noProxy` is an array. Java's `http.nonProxyHosts` uses pipe-separated wildcards.

Conversion:
```typescript
const noProxy = ['localhost', '*.internal.com', '10.*'];
const javaNoProxy = noProxy.join('|'); // "localhost|*.internal.com|10.*"
```

### Potential Issues and Edge Cases

**Issue 1: Authentication with Java**
Java's `-Dhttp.proxyUser` only works with `java.net.*` classes. Apache HttpClient and OkHttp have different auth mechanisms. The language server's HTTP client choice matters.

**Workaround**: Most corporate proxies support NTLM or Kerberos, which Java can handle via `-Djava.net.useSystemProxies=true`. Document this.

**Issue 2: SOCKS Proxies**
VS Code supports SOCKS proxies (socks4:// or socks5://). Java has separate properties:
```
-DsocksProxyHost=proxy.example.com
-DsocksProxyPort=1080
```

Need to detect SOCKS URLs and convert appropriately.

**Issue 3: Proxy Auto-Config (PAC)**
VS Code doesn't support PAC files directly. If `http.proxy` is empty but OS uses PAC, Java's `useSystemProxies=true` might help, but it's inconsistent across platforms.

**Issue 4: SSL Certificate Validation**
`http.proxyStrictSSL` affects SSL validation. For Java:
```
-Djavax.net.ssl.trustStore=/path/to/cacerts
-Djavax.net.ssl.trustStorePassword=changeit
```

This is complex and may require additional configuration. Document as known limitation.

**Issue 5: Build-Time vs Runtime**
Build scripts (`.mjs`) run outside VS Code and can't access settings. They must rely on environment variables. Document this clearly.

**Issue 6: Language Server Restart**
Changing proxy settings requires restarting the language server. Need to detect `http.proxy` changes and prompt for reload, similar to how `ls.javaHome` changes are handled.

### File Locations for Implementation

**Core Proxy Utility**:
- New file: `/Users/dslenk/dev/src/sonarlint-vscode/src/util/proxy.ts`
  - Implements `getProxyConfig()`, `getProxyJavaArgs()`, etc.

**Language Server Startup**:
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/src/lsp/server.ts`
  - In `languageServerCommand()` function, inject proxy args after user vmargs

**Settings Monitoring**:
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/src/settings/settings.ts`
  - Add `http.proxy` to configuration change detection
  - Prompt for restart when proxy settings change

**Extension Activation**:
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/src/extension.ts`
  - Add configuration change listener for `http` settings
  - Log proxy configuration on startup (for debugging)

**JRE Download**:
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/src/java/jre.ts`
  - Add proxy agent to `https.get()` call in `download()` function

**Build Scripts** (optional/future):
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/build-sonarlint/artifactory.mjs`
  - Check environment variables for proxy
  - Create proxy-aware fetch wrapper
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/build-sonarlint/downloadUtil.mjs`
  - Use proxy-aware fetch

**Package Dependencies**:
- Modify: `/Users/dslenk/dev/src/sonarlint-vscode/package.json`
  - Add `"http-proxy-agent": "^7.0.0"`
  - Add `"https-proxy-agent": "^7.0.0"`

**Documentation**:
- Update: `/Users/dslenk/dev/src/sonarlint-vscode/README.md`
  - Add proxy configuration section
- Update: `/Users/dslenk/dev/src/sonarlint-vscode/CLAUDE.md`
  - Document proxy implementation details

### Testing Strategy

**Manual Testing Scenarios**:
1. Configure `http.proxy` with HTTP proxy, verify language server connects
2. Configure `http.proxy` with HTTPS proxy, verify connections work
3. Configure proxy with authentication, verify credentials are passed
4. Configure `http.noProxy` with patterns, verify exclusions work
5. Change proxy settings, verify restart prompt appears
6. Empty `http.proxy`, verify no proxy is used
7. Test with corporate proxy (real-world scenario)

**Test Files to Update**:
- `/Users/dslenk/dev/src/sonarlint-vscode/test/suite/util.test.ts` - Add proxy utility tests
- New test file: `test/suite/proxy.test.ts` - Test proxy parsing, URL handling

**Integration Test** (optional):
- Set up local proxy (e.g., using `http-proxy` npm package)
- Configure extension to use it
- Verify all network operations route through proxy

### Summary of Changes Required

**High Priority** (Core Functionality):
1. Create `src/util/proxy.ts` - Proxy configuration utilities
2. Modify `src/lsp/server.ts` - Inject Java proxy args at language server startup
3. Modify `src/settings/settings.ts` - Detect proxy setting changes and prompt restart
4. Add proxy agent dependencies to `package.json`

**Medium Priority** (User Experience):
5. Modify `src/java/jre.ts` - Add proxy support to JRE downloads
6. Update documentation with proxy configuration guide
7. Add error messages for proxy connection failures

**Low Priority** (Build-Time Support):
8. Modify build scripts (`artifactory.mjs`, `downloadUtil.mjs`) - Environment variable proxy support
9. Document build-time proxy configuration for developers

**Testing**:
10. Add unit tests for proxy utilities
11. Add integration tests with actual proxy
12. Manual testing checklist for various proxy configurations

## User Notes
<!-- Any specific notes or requirements from the developer -->

## Work Log
<!-- Updated as work progresses -->
- [YYYY-MM-DD] Started task, initial research
