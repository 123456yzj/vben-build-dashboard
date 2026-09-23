import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface Project {
  name: string;
  path: string;
  buildCommand: string;
}

export async function loadProjects(file = process.env.PROJECTS_FILE || path.resolve('config/projects.json')): Promise<Project[]> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('projects' in parsed) || !Array.isArray(parsed.projects)) {
    throw new Error('config/projects.json must contain a projects array');
  }
  const names = new Set<string>();
  return parsed.projects.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('name' in item) || !('path' in item) || !('buildCommand' in item) ||
      typeof item.name !== 'string' || !item.name.trim() || typeof item.path !== 'string' || !path.isAbsolute(item.path) ||
      typeof item.buildCommand !== 'string' || !item.buildCommand.trim() || names.has(item.name)) {
      throw new Error('Each project needs a unique name, absolute path, and nonempty buildCommand');
    }
    names.add(item.name);
    return { name: item.name, path: item.path, buildCommand: item.buildCommand };
  });
}

export function projectByName(projects: Project[], name: string): Project {
  const project = projects.find((item) => item.name === name);
  if (!project) throw Object.assign(new Error('项目不存在'), { statusCode: 404 });
  return project;
}
