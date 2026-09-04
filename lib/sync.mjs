import { promises as fs } from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

// Helper to resolve app directory from packageName or name
export function resolveAppDistDir(targetRepoPath, appNameOrPkg) {
  const cleanName = appNameOrPkg.replace(/^@repo\//, 'web-');
  const dir1 = path.join(targetRepoPath, 'apps', cleanName, 'dist');
  const dir2 = path.join(targetRepoPath, 'apps', appNameOrPkg, 'dist');
  return { path1: dir1, path2: dir2, cleanName };
}

export async function findDistDir(targetRepoPath, appNameOrPkg) {
  const { path1, path2 } = resolveAppDistDir(targetRepoPath, appNameOrPkg);
  try {
    const stat1 = await fs.stat(path1);
    if (stat1.isDirectory()) return path1;
  } catch {}

  try {
    const stat2 = await fs.stat(path2);
    if (stat2.isDirectory()) return path2;
  } catch {}

  return null;
}

export async function syncAppArtifacts(targetRepoPath, appNameOrPkg, destinationPath) {
  const sourceDist = await findDistDir(targetRepoPath, appNameOrPkg);
  if (!sourceDist) {
    throw new Error(`未找到业务包 [${appNameOrPkg}] 的 dist 产物目录，请先执行打包！`);
  }

  const normalizedDest = path.resolve(destinationPath);
  let backupPath = null;

  // 1. 如果目标目录已存在，自动生成带时间戳的历史备份快照
  try {
    const stat = await fs.stat(normalizedDest);
    if (stat.isDirectory()) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      backupPath = `${normalizedDest}_backup_${timestamp}`;

      // 执行重命名备份
      await fs.rename(normalizedDest, backupPath);
    }
  } catch (err) {
    // 目录不存在则直接新建，无需备份
  }

  // 2. 确保父目录存在
  await fs.mkdir(normalizedDest, { recursive: true });

  // 3. 执行完整递归拷贝
  await fs.cp(sourceDist, normalizedDest, { recursive: true });

  return {
    success: true,
    sourceDist,
    destinationPath: normalizedDest,
    backupPath,
    message: backupPath
      ? `已成功同步至目标目录！上一版本已自动备份至 ${path.basename(backupPath)}`
      : `已成功同步至目标目录！`,
  };
}

export function createZipStream(sourceDir) {
  const archive = archiver('zip', {
    zlib: { level: 9 }, // 最高压缩比
  });

  archive.directory(sourceDir, false);
  archive.finalize();

  return archive;
}
