/* --------------------------------------------------------------------------------------------
 * SonarLint for VisualStudio Code
 * Copyright (C) 2017-2025 SonarSource SA
 * sonarlint@sonarsource.com
 * Licensed under the LGPLv3 License. See LICENSE.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as Path from 'path';
import * as VSCode from 'vscode';
import { TransportKind } from 'vscode-languageclient/node';
import { getSonarLintConfiguration } from '../settings/settings';
import { RequirementsData } from '../util/requirements';
import * as util from '../util/util';
import { maybeAddCFamilyJar } from '../cfamily/ondemand';
import { getProxyConfig, getProxyJavaArgs, getProxyJavaEnv } from '../util/proxy';

declare let v8debug: object;
const DEBUG = typeof v8debug === 'object' || util.startedInDebugMode(process);

export async function languageServerCommand(
  context: VSCode.ExtensionContext,
  requirements: RequirementsData
) {
  const serverJar = Path.resolve(context.extensionPath, 'server', 'sonarlint-ls.jar');
  const javaExecutablePath = Path.resolve(requirements.javaHome, 'bin', 'java');

  const params = [];
  if (DEBUG) {
    params.push('-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8000,quiet=y');
    params.push('-Dsonarlint.telemetry.disabled=true');
    params.push('-Dsonarlint.monitoring.disabled=true');
  }

  const sonarLintConfiguration = getSonarLintConfiguration();
  const vmargs = sonarLintConfiguration.get('ls.vmargs', '');
  parseVMargs(params, vmargs);
  if (sonarLintConfiguration.get('startFlightRecorder', false)) {
    params.push('-Dsonarlint.flightrecorder.enabled=true');
  }

  // Get proxy configuration once to avoid duplicate calls
  const proxyConfig = getProxyConfig();

  // Inject proxy configuration if not already specified by user
  const proxyArgs = getProxyJavaArgs(proxyConfig);
  proxyArgs.forEach(proxyArg => {
    // Only add proxy arg if user hasn't already specified it in ls.vmargs
    const proxyProperty = proxyArg.split('=')[0]; // e.g., '-Dhttp.proxyHost'
    const alreadySet = params.some(param => param.startsWith(proxyProperty));
    if (!alreadySet) {
      params.push(proxyArg);
    }
  });

  params.push('-jar', serverJar);
  params.push('-stdio');
  params.push('-analyzers');
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonargo.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarjava.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarjavasymbolicexecution.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarjs.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarphp.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarpython.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarhtml.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarxml.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonartext.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonariac.jar'));
  params.push(Path.resolve(context.extensionPath, 'analyzers', 'sonarlintomnisharp.jar'));
  await maybeAddCFamilyJar(params);

  // Get proxy credentials as environment variables (hidden from process list)
  const proxyEnv = getProxyJavaEnv(proxyConfig);

  return {
    command: javaExecutablePath,
    args: params,
    transport: TransportKind.stdio,
    options: {
      env: { ...process.env, ...proxyEnv }
    }
  };
}

export function parseVMargs(params: string[], vmargsLine: string) {
  if (!vmargsLine) {
    return;
  }
  const vmargs = vmargsLine.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (vmargs === null) {
    return;
  }
  vmargs.forEach(arg => {
    //remove all standalone double quotes
    arg = arg.replace(/(\\)?"/g, function ($0, $1) {
      return $1 ? $0 : '';
    });
    //unescape all escaped double quotes
    arg = arg.replace(/(\\)"/g, '"');
    if (params.indexOf(arg) < 0) {
      params.push(arg);
    }
  });
}
