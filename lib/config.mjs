import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configFilePath = path.join(rootDir, 'config.json');

const DEFAULT_CONFIG = {
  port: 9527,
  host: '0.0.0.0',
  targetRepoPath: 'D:/project/impact/app-v1/web-framework',
  maxMemoryMb: 8192,
  allowParallel: true,
  protectedBranches: ['master', 'main', 'develop', 'test'],
  deployTargets: {
    '@repo/admin': '/var/www/web-admin',
    '@repo/bms': '/var/www/web-bms',
    '@repo/tms': '/var/www/web-tms',
    '@repo/multichannel': '/var/www/web-multichannel',
  },
  autoDeployAfterBuild: false,
  selectedNodeVersion: '',
  selectedPnpmVersion: '',
};

let cachedConfig = null;

export function loadConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
      saveConfig(cachedConfig);
    }
  } catch (err) {
    console.error('[Config] Failed to load config.json, using defaults:', err.message);
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

export function normalizeRepoPath(targetPath) {
  if (!targetPath) return '';
  let p = String(targetPath).trim().replace(/\\/g, '/');
  if (process.platform !== 'win32' && /^[a-zA-Z]:\//.test(p)) {
    const drive = p[0].toLowerCase();
    const rest = p.slice(2);
    p = `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
  }
  return p.replace(/\/+$/, '');
}

export function getConfig() {
  if (!cachedConfig) {
    loadConfig();
  }
  const cloned = { ...cachedConfig };
  cloned.targetRepoPath = normalizeRepoPath(cloned.targetRepoPath);
  return cloned;
}

/**
 * 校验待保存配置数据的合理性
 * @param {Object} newConfig - 待保存的配置对象
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateConfig(newConfig = {}) {
  // 1. 目标项目根路径校验
  if ('targetRepoPath' in newConfig) {
    const rawPath = String(newConfig.targetRepoPath || '').trim();
    if (!rawPath) {
      return { valid: false, field: 'targetRepoPath', message: '目标项目路径不能为空！' };
    }

    const normalized = normalizeRepoPath(rawPath);

    // 检查路径是否存在
    if (!fs.existsSync(normalized)) {
      return {
        valid: false,
        field: 'targetRepoPath',
        message: `目标项目路径不存在: "${rawPath}"`,
      };
    }

    // 检查是否为目录
    try {
      const stat = fs.statSync(normalized);
      if (!stat.isDirectory()) {
        return {
          valid: false,
          field: 'targetRepoPath',
          message: `目标路径必须是文件夹目录，而不是文件: "${rawPath}"`,
        };
      }
    } catch (err) {
      return { valid: false, field: 'targetRepoPath', message: `无法读取目标目录状态: ${err.message}` };
    }

    // 检查目标目录下是否存在 package.json 或 .git
    const hasPkgJson = fs.existsSync(path.join(normalized, 'package.json'));
    const hasGit = fs.existsSync(path.join(normalized, '.git'));
    if (!hasPkgJson && !hasGit) {
      return {
        valid: false,
        field: 'targetRepoPath',
        message: `目标目录中未找到 package.json 或 .git，请确认是否为有效前端项目根目录`,
      };
    }
  }

  // 2. 端口号校验
  if ('port' in newConfig && newConfig.port !== undefined && newConfig.port !== null) {
    const portNum = Number(newConfig.port);
    if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
      return { valid: false, field: 'port', message: '服务端口必须为 1024 ~ 65535 之间的有效整数！' };
    }
  }

  // 3. 构建最大内存校验
  if ('maxMemoryMb' in newConfig && newConfig.maxMemoryMb !== undefined && newConfig.maxMemoryMb !== null) {
    const memNum = Number(newConfig.maxMemoryMb);
    if (isNaN(memNum) || memNum < 512) {
      return { valid: false, field: 'maxMemoryMb', message: '构建最大内存上限不能低于 512 MB！' };
    }
  }

  // 4. 受保护分支白名单校验
  if ('protectedBranches' in newConfig && newConfig.protectedBranches !== undefined) {
    if (!Array.isArray(newConfig.protectedBranches)) {
      return { valid: false, field: 'protectedBranches', message: '受保护分支配置必须为数组格式！' };
    }
  }

  return { valid: true };
}

export function saveConfig(newConfig) {
  cachedConfig = { ...DEFAULT_CONFIG, ...cachedConfig, ...newConfig };
  fs.writeFileSync(configFilePath, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  const cloned = { ...cachedConfig };
  cloned.targetRepoPath = normalizeRepoPath(cloned.targetRepoPath);
  return cloned;
}

