import { computed, ref, type Ref } from 'vue';
import { buildProject, getProjectDetail, getProjects, gitAction } from '../api/project';
import type { Project, ProjectAction, ProjectDetail } from '../types/project';
import type { SocketMessage } from './useWebSocket';

export function useProject(selected: Ref<string | null>) {
  const projects = ref<Project[]>([]);
  const detail = ref<ProjectDetail | null>(null);
  const loading = ref(false);
  const working = ref(false);
  const error = ref('');
  const branch = ref('');
  const listBranches = ref<Record<string, string>>({});
  const current = computed(() => projects.value.find((project) => project.name === selected.value));

  async function loadProjects() {
    loading.value = true;
    try {
      projects.value = await getProjects();
      error.value = '';
    } catch (cause) { error.value = (cause as Error).message; }
    finally { loading.value = false; }
  }

  async function loadDetail() {
    if (!selected.value) return;
    try {
      detail.value = await getProjectDetail(selected.value);
      branch.value = detail.value.git?.branch || '';
      error.value = '';
    } catch (cause) { error.value = (cause as Error).message; }
  }

  function select(name: string | null) {
    detail.value = null;
    if (name) void loadDetail();
  }

  function applyMessage(message: SocketMessage) {
    const item = projects.value.find((project) => project.name === message.project);
    if (message.type === 'git' && message.git) {
      if (item) item.git = message.git;
      if (detail.value?.name === message.project) detail.value.git = message.git;
    }
    if (message.type === 'build' && message.record) {
      if (item) item.latestBuild = { ...message.record };
      if (detail.value?.name === message.project) {
        detail.value.latestBuild = { ...message.record };
        const index = detail.value.history.findIndex((record) => record.id === message.record?.id);
        if (index < 0) detail.value.history.unshift({ ...message.record });
        else detail.value.history[index] = { ...message.record };
      }
    }
    if (detail.value?.name !== message.project) return;
    if (message.type === 'busy') detail.value.busy = !!message.busy;
    if (message.type === 'log' && message.text) {
      detail.value.logs.push({ stream: message.stream || 'stdout', text: message.text, buildId: message.buildId || '' });
      if (detail.value.logs.length > 2000) detail.value.logs.splice(0, detail.value.logs.length - 2000);
    }
  }

  async function action(name: string, kind: ProjectAction, target?: string) {
    working.value = true;
    error.value = '';
    try {
      if (kind === 'build') {
        if (detail.value?.name === name) detail.value.logs = [];
        await buildProject(name);
      } else {
        await gitAction(name, kind, target);
      }
      await loadProjects();
      if (selected.value === name) await loadDetail();
    } catch (cause) { error.value = (cause as Error).message; }
    finally { working.value = false; }
  }

  return { projects, detail, loading, working, error, branch, listBranches, current, loadProjects, loadDetail, select, applyMessage, action };
}
