import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DashboardConfig } from '../types.js';
import { errorMessage, isRecord } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Both src/lib and dist/lib are two levels below the backend directory.
const backendDir = path.resolve(__dirname, '../..');
const repoRootDir = path.resolve(backendDir, '..');

export interface ConfigValidation {
  valid: boolean;
  field?: keyof DashboardConfig;
  message?: string;
}

const DEFAULT_CONFIG: DashboardConfig = {
  port: 9527,
  host: '0.0.0.0',
  targetRepoPath: 'D:/project/impact/app-v1/web-framework',
  protectedBranches: ['master', 'main', 'develop', 'test'],
};

let cachedConfig: DashboardConfig | null = null;

export function resolveConfigPath(): string {
  if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;
  const rootConfig = path.join(repoRootDir, 'config.json');
  if (fs.existsSync(rootConfig)) return rootConfig;
  const backendConfig = path.join(backendDir, 'config.json');
  if (fs.existsSync(backendConfig)) return backendConfig;
  return fs.existsSync(path.join(repoRootDir, 'package.json')) ? rootConfig : backendConfig;
}

const configFilePath = resolveConfigPath();

function mergeKnownConfig(...sources: unknown[]): DashboardConfig {
  const merged: DashboardConfig = { ...DEFAULT_CONFIG };
  for (const source of sources) {
    if (!isRecord(source)) continue;
    if (typeof source.port === 'number') merged.port = source.port;
    if (typeof source.host === 'string') merged.host = source.host;
    if (typeof source.targetRepoPath === 'string') merged.targetRepoPath = source.targetRepoPath;
    if (Array.isArray(source.protectedBranches) && source.protectedBranches.every((v) => typeof v === 'string')) {
      merged.protectedBranches = source.protectedBranches;
    }
  }
  return merged;
}

export function loadConfig(): DashboardConfig {
  try {
    if (fs.existsSync(configFilePath)) {
      cachedConfig = mergeKnownConfig(JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) as unknown);
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
      saveConfig(cachedConfig);
    }
  } catch (error) {
    console.error('[Config] Failed to load config.json, using defaults:', errorMessage(error));
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

export function normalizeRepoPath(targetPath: unknown): string {
  if (!targetPath) return '';
  let normalized = String(targetPath).trim().replace(/\\/g, '/');
  if (process.platform !== 'win32' && /^[a-zA-Z]:\//.test(normalized)) {
    const drive = normalized[0]?.toLowerCase() ?? '';
    const rest = normalized.slice(2);
    normalized = `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
  }
  return normalized.replace(/\/+$/, '');
}

export function getConfig(): DashboardConfig {
  if (!cachedConfig) loadConfig();
  const cloned: DashboardConfig = { ...(cachedConfig ?? DEFAULT_CONFIG) };
  if (process.env.TARGET_REPO_PATH) {
    const currentPath = normalizeRepoPath(cloned.targetRepoPath);
    if (!currentPath || !fs.existsSync(currentPath)) cloned.targetRepoPath = process.env.TARGET_REPO_PATH;
  }
  cloned.targetRepoPath = normalizeRepoPath(cloned.targetRepoPath);
  return cloned;
}

export function validateConfig(newConfig: unknown = {}): ConfigValidation {
  if (!isRecord(newConfig)) return { valid: false, message: '配置数据必须为对象' };

  if ('targetRepoPath' in newConfig) {
    const rawPath = String(newConfig.targetRepoPath ?? '').trim();
    if (!rawPath) return { valid: false, field: 'targetRepoPath', message: '目标项目路径不能为空！' };
    const normalized = normalizeRepoPath(rawPath);
    if (!fs.existsSync(normalized)) {
      return { valid: false, field: 'targetRepoPath', message: `目标项目路径不存在: "${rawPath}"` };
    }
    try {
      if (!fs.statSync(normalized).isDirectory()) {
        return { valid: false, field: 'targetRepoPath', message: `目标路径必须是文件夹目录，而不是文件: "${rawPath}"` };
      }
    } catch (error) {
      return { valid: false, field: 'targetRepoPath', message: `无法读取目标目录状态: ${errorMessage(error)}` };
    }
    if (!fs.existsSync(path.join(normalized, 'package.json')) && !fs.existsSync(path.join(normalized, '.git'))) {
      return { valid: false, field: 'targetRepoPath', message: '目标目录中未找到 package.json 或 .git，请确认是否为有效项目根目录' };
    }
  }

  if ('port' in newConfig && newConfig.port != null) {
    const port = Number(newConfig.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return { valid: false, field: 'port', message: '服务端口必须为 1024 ~ 65535 之间的有效整数！' };
    }
  }
  if ('protectedBranches' in newConfig && newConfig.protectedBranches !== undefined && !Array.isArray(newConfig.protectedBranches)) {
    return { valid: false, field: 'protectedBranches', message: '受保护分支配置必须为数组格式！' };
  }
  return { valid: true };
}

export function saveConfig(newConfig: unknown): DashboardConfig {
  cachedConfig = mergeKnownConfig(cachedConfig, newConfig);
  fs.writeFileSync(configFilePath, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  return { ...cachedConfig, targetRepoPath: normalizeRepoPath(cachedConfig.targetRepoPath) };
}
