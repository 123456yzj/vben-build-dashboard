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
  if (!targetPath) return targetPath;
  if (process.platform !== 'win32' && /^[a-zA-Z]:[/\\]/.test(targetPath)) {
    const drive = targetPath[0].toLowerCase();
    const rest = targetPath.slice(2).replace(/\\/g, '/');
    return `/mnt/${drive}${rest.startsWith('/') ? '' : '/'}${rest}`;
  }
  return targetPath;
}

export function getConfig() {
  if (!cachedConfig) {
    loadConfig();
  }
  const cloned = { ...cachedConfig };
  cloned.targetRepoPath = normalizeRepoPath(cloned.targetRepoPath);
  return cloned;
}

export function saveConfig(newConfig) {
  cachedConfig = { ...DEFAULT_CONFIG, ...cachedConfig, ...newConfig };
  fs.writeFileSync(configFilePath, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  const cloned = { ...cachedConfig };
  cloned.targetRepoPath = normalizeRepoPath(cloned.targetRepoPath);
  return cloned;
}
