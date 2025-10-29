/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as vscode from 'vscode';
import { URL } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ProxyConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  protocol?: 'http' | 'https' | 'socks' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
  noProxy?: string[];
  strictSSL?: boolean;
}

/**
 * Gets proxy configuration from VS Code settings.
 * Reads http.proxy, http.proxySupport, http.proxyStrictSSL, and http.noProxy.
 *
 * @returns ProxyConfig object or null if proxy is disabled
 */
export function getProxyConfig(): ProxyConfig | null {
  const httpConfig = vscode.workspace.getConfiguration('http');

  // Check if proxy support is enabled
  const proxySupport = httpConfig.get<string>('proxySupport', 'on');
  if (proxySupport === 'off') {
    return { enabled: false };
  }

  const proxyUrl = httpConfig.get<string>('proxy');
  if (!proxyUrl || proxyUrl.trim() === '') {
    return { enabled: false };
  }

  try {
    const parsed = new URL(proxyUrl);
    const config: ProxyConfig = {
      enabled: true,
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : getDefaultPort(parsed.protocol),
      protocol: normalizeProtocol(parsed.protocol),
      strictSSL: httpConfig.get<boolean>('proxyStrictSSL', true)
    };

    // Extract credentials from URL if present
    if (parsed.username) {
      config.username = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
      config.password = decodeURIComponent(parsed.password);
    }

    // Get noProxy list
    const noProxy = httpConfig.get<string[]>('noProxy', []);
    if (noProxy && noProxy.length > 0) {
      config.noProxy = noProxy;
    }

    return config;
  } catch (error) {
    console.error('Failed to parse proxy URL:', error);
    return { enabled: false };
  }
}

/**
 * Gets the default port for a proxy protocol.
 */
function getDefaultPort(protocol: string): number {
  if (protocol === 'https:') {
    return 443;
  } else if (protocol.startsWith('socks')) {
    return 1080;
  }
  return 80; // http and others default to 80
}

/**
 * Normalizes protocol string to our supported types.
 */
function normalizeProtocol(protocol: string): 'http' | 'https' | 'socks' | 'socks4' | 'socks5' {
  const normalized = protocol.replace(':', '').toLowerCase();
  if (normalized === 'https') return 'https';
  if (normalized === 'socks4') return 'socks4';
  if (normalized === 'socks5') return 'socks5';
  if (normalized === 'socks') return 'socks';
  return 'http';
}

/**
 * Generates Java system property arguments for proxy configuration.
 * Returns array of JVM arguments like ['-Dhttp.proxyHost=...', '-Dhttp.proxyPort=...', etc.]
 *
 * Handles both HTTP and HTTPS proxy properties, authentication, and noProxy conversion.
 *
 * @returns Array of JVM argument strings
 */
export function getProxyJavaArgs(): string[] {
  const config = getProxyConfig();
  if (!config || !config.enabled || !config.host) {
    return [];
  }

  const args: string[] = [];

  // Only set HTTP/HTTPS properties for http and https protocols
  if (config.protocol === 'http' || config.protocol === 'https') {
    // HTTP proxy properties
    args.push(`-Dhttp.proxyHost=${config.host}`);
    args.push(`-Dhttp.proxyPort=${config.port}`);

    // HTTPS proxy properties (use same proxy for HTTPS)
    args.push(`-Dhttps.proxyHost=${config.host}`);
    args.push(`-Dhttps.proxyPort=${config.port}`);

    // Authentication (if provided)
    // Note: This exposes credentials in process list. Consider using JAVA_TOOL_OPTIONS env var instead.
    if (config.username) {
      args.push(`-Dhttp.proxyUser=${config.username}`);
      args.push(`-Dhttps.proxyUser=${config.username}`);
    }
    if (config.password) {
      // WARNING: Password visible in ps output
      args.push(`-Dhttp.proxyPassword=${config.password}`);
      args.push(`-Dhttps.proxyPassword=${config.password}`);
    }

    // NoProxy conversion: VS Code uses array, Java uses pipe-separated string
    if (config.noProxy && config.noProxy.length > 0) {
      const javaNoProxy = config.noProxy.join('|');
      args.push(`-Dhttp.nonProxyHosts=${javaNoProxy}`);
    }
  } else if (config.protocol === 'socks' || config.protocol === 'socks4' || config.protocol === 'socks5') {
    // SOCKS proxy properties
    args.push(`-DsocksProxyHost=${config.host}`);
    args.push(`-DsocksProxyPort=${config.port}`);

    if (config.username) {
      args.push(`-Djava.net.socks.username=${config.username}`);
    }
    if (config.password) {
      args.push(`-Djava.net.socks.password=${config.password}`);
    }
  }

  return args;
}

/**
 * Creates an HTTPS proxy agent for Node.js HTTP(S) requests.
 * Uses https-proxy-agent which properly handles proxy authentication and SSL.
 *
 * @returns HttpsProxyAgent instance or undefined if no proxy configured
 */
export function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const config = getProxyConfig();
  if (!config || !config.enabled || !config.host) {
    return undefined;
  }

  // Only support HTTP/HTTPS proxies for HTTPS requests
  // SOCKS proxies would need a different agent (e.g., socks-proxy-agent)
  if (config.protocol !== 'http' && config.protocol !== 'https') {
    return undefined;
  }

  // Build proxy URL
  let proxyUrl = `${config.protocol}://`;
  if (config.username && config.password) {
    proxyUrl += `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`;
  }
  proxyUrl += `${config.host}:${config.port}`;

  // Create HTTPS proxy agent with SSL configuration
  return new HttpsProxyAgent(proxyUrl, {
    rejectUnauthorized: config.strictSSL
  });
}

/**
 * Checks if a URL should bypass the proxy based on noProxy patterns.
 * This is primarily for informational purposes; ProxyAgent handles this automatically.
 *
 * @param url URL to check
 * @returns true if URL should bypass proxy
 */
export function shouldBypassProxy(url: string): boolean {
  const config = getProxyConfig();
  if (!config || !config.enabled || !config.noProxy || config.noProxy.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    return config.noProxy.some(pattern => {
      // Simple pattern matching (VS Code noProxy supports wildcards)
      if (pattern === '*') return true;
      if (pattern.startsWith('*.')) {
        // Wildcard subdomain: *.example.com matches foo.example.com but not example.com
        const domain = pattern.substring(2);
        return hostname.endsWith('.' + domain);
      }
      if (pattern.startsWith('.')) {
        // Leading dot: .example.com matches example.com and foo.example.com
        const domain = pattern.substring(1);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      // Exact match or IP range
      return hostname === pattern || hostname.endsWith('.' + pattern);
    });
  } catch (error) {
    return false;
  }
}
