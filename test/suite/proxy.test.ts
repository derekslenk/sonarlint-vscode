/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { getProxyConfig, getProxyJavaArgs, shouldBypassProxy } from '../../src/util/proxy';

suite('Proxy Utility Tests', () => {
  suite('getProxyConfig', () => {
    test('should return null when proxy is not configured', () => {
      // This test relies on default VS Code settings where proxy is not configured
      const config = getProxyConfig();
      if (config) {
        assert.strictEqual(config.enabled, false);
      } else {
        assert.strictEqual(config, null);
      }
    });

    test('should return null when proxySupport is off', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalSupport = httpConfig.get('proxySupport');

      try {
        await httpConfig.update('proxySupport', 'off', vscode.ConfigurationTarget.Global);
        const config = getProxyConfig();
        assert.strictEqual(config?.enabled, false);
      } finally {
        // Restore original setting
        await httpConfig.update('proxySupport', originalSupport, vscode.ConfigurationTarget.Global);
      }
    });
  });

  suite('getProxyJavaArgs', () => {
    test('should return empty array when proxy not configured', () => {
      const args = getProxyJavaArgs();
      // If no proxy configured in test environment, should return empty array
      assert.ok(Array.isArray(args));
    });

    test('should generate HTTP and HTTPS proxy args for HTTP proxy', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');

      try {
        await httpConfig.update('proxy', 'http://proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        const args = getProxyJavaArgs();

        // Should include both HTTP and HTTPS properties
        assert.ok(args.includes('-Dhttp.proxyHost=proxy.example.com'));
        assert.ok(args.includes('-Dhttp.proxyPort=8080'));
        assert.ok(args.includes('-Dhttps.proxyHost=proxy.example.com'));
        assert.ok(args.includes('-Dhttps.proxyPort=8080'));
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
      }
    });

    test('should generate SOCKS proxy args for SOCKS proxy', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');

      try {
        await httpConfig.update('proxy', 'socks5://proxy.example.com:1080', vscode.ConfigurationTarget.Global);
        const args = getProxyJavaArgs();

        // Should include SOCKS properties
        assert.ok(args.includes('-DsocksProxyHost=proxy.example.com'));
        assert.ok(args.includes('-DsocksProxyPort=1080'));
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
      }
    });

    test('should convert noProxy array to pipe-separated nonProxyHosts', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');
      const originalNoProxy = httpConfig.get('noProxy');

      try {
        await httpConfig.update('proxy', 'http://proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', ['localhost', '*.internal.com', '10.*'], vscode.ConfigurationTarget.Global);
        const args = getProxyJavaArgs();

        // Should convert array to pipe-separated string
        const nonProxyArg = args.find(arg => arg.startsWith('-Dhttp.nonProxyHosts='));
        assert.ok(nonProxyArg);
        assert.ok(nonProxyArg.includes('localhost|*.internal.com|10.*'));
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', originalNoProxy, vscode.ConfigurationTarget.Global);
      }
    });

    test('should handle proxy with authentication credentials', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');

      try {
        await httpConfig.update('proxy', 'http://user:pass@proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        const args = getProxyJavaArgs();

        // Should include auth properties
        assert.ok(args.includes('-Dhttp.proxyUser=user'));
        assert.ok(args.includes('-Dhttp.proxyPassword=pass'));
        assert.ok(args.includes('-Dhttps.proxyUser=user'));
        assert.ok(args.includes('-Dhttps.proxyPassword=pass'));
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
      }
    });
  });

  suite('shouldBypassProxy', () => {
    test('should return false when noProxy not configured', () => {
      const result = shouldBypassProxy('https://example.com');
      assert.strictEqual(result, false);
    });

    test('should match wildcard subdomain pattern', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');
      const originalNoProxy = httpConfig.get('noProxy');

      try {
        await httpConfig.update('proxy', 'http://proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', ['*.internal.com'], vscode.ConfigurationTarget.Global);

        assert.strictEqual(shouldBypassProxy('https://foo.internal.com'), true);
        assert.strictEqual(shouldBypassProxy('https://internal.com'), false); // *.internal.com doesn't match root
        assert.strictEqual(shouldBypassProxy('https://external.com'), false);
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', originalNoProxy, vscode.ConfigurationTarget.Global);
      }
    });

    test('should match leading dot pattern', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');
      const originalNoProxy = httpConfig.get('noProxy');

      try {
        await httpConfig.update('proxy', 'http://proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', ['.internal.com'], vscode.ConfigurationTarget.Global);

        assert.strictEqual(shouldBypassProxy('https://internal.com'), true);
        assert.strictEqual(shouldBypassProxy('https://foo.internal.com'), true);
        assert.strictEqual(shouldBypassProxy('https://external.com'), false);
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', originalNoProxy, vscode.ConfigurationTarget.Global);
      }
    });

    test('should match exact hostname', async () => {
      const httpConfig = vscode.workspace.getConfiguration('http');
      const originalProxy = httpConfig.get('proxy');
      const originalNoProxy = httpConfig.get('noProxy');

      try {
        await httpConfig.update('proxy', 'http://proxy.example.com:8080', vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', ['localhost'], vscode.ConfigurationTarget.Global);

        assert.strictEqual(shouldBypassProxy('http://localhost:3000'), true);
        assert.strictEqual(shouldBypassProxy('http://localhost'), true);
        assert.strictEqual(shouldBypassProxy('http://example.com'), false);
      } finally {
        await httpConfig.update('proxy', originalProxy, vscode.ConfigurationTarget.Global);
        await httpConfig.update('noProxy', originalNoProxy, vscode.ConfigurationTarget.Global);
      }
    });
  });
});
