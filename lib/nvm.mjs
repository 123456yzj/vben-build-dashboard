import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export function getNvmDir() {
  if (process.env.NVM_DIR) return process.env.NVM_DIR;
  const home = os.homedir();
  return path.join(home, '.nvm');
}

export async function getInstalledNodeVersions() {
  const current = process.version;
  const nvmDir = getNvmDir();
  const versionsDir = path.join(nvmDir, 'versions', 'node');

  const versions = [];
  try {
    const entries = await fs.readdir(versionsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('v')) {
        versions.push(e.name);
      }
    }
  } catch {
    // If not found or on Windows without NVM, at least return current process version
  }

  if (!versions.includes(current)) {
    versions.unshift(current);
  }

  // Sort descending
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  return {
    current,
    versions,
    nvmAvailable: versions.length > 1 || (await checkNvmInstalled()),
  };
}

export async function checkNvmInstalled() {
  try {
    const nvmDir = getNvmDir();
    await fs.access(path.join(nvmDir, 'nvm.sh'));
    return true;
  } catch {
    return false;
  }
}

export function getNodeBinPath(version) {
  if (!version || version === process.version) return '';
  const nvmDir = getNvmDir();
  const verName = version.startsWith('v') ? version : `v${version}`;
  const binDir = path.join(nvmDir, 'versions', 'node', verName, 'bin');
  return binDir;
}

export async function getCurrentPnpmVersion() {
  try {
    const { stdout } = await execAsync('pnpm --version');
    return stdout.trim();
  } catch {
    return 'not installed';
  }
}

export async function installPnpmVersion(version) {
  try {
    const { stdout, stderr } = await execAsync(`npm install -g pnpm@${version}`);
    return { success: true, stdout, stderr };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function installNodeVersion(version, onLog = () => {}) {
  const nvmDir = getNvmDir();
  const nvmScript = path.join(nvmDir, 'nvm.sh');

  const cmd = `bash -c "source ${nvmScript} && nvm install ${version}"`;
  try {
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    return { success: true, stdout, stderr };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
