<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { CircleAlert, Terminal } from 'lucide-vue-next';
import ProjectList from './components/ProjectList.vue';
import ProjectDetail from './components/ProjectDetail.vue';
import { useProject } from './composables/useProject';
import { useWebSocket } from './composables/useWebSocket';
import { useProjectRoute } from './router';

const route = useProjectRoute();
const project = useProject(route.selected);
const { connected, connect, disconnect } = useWebSocket(project.applyMessage, () => {
  void project.loadProjects();
  if (route.selected.value) void project.loadDetail();
});

function navigate(name: string | null) {
  route.navigate(name);
  project.select(name);
}

function onPopState() {
  route.onPopState();
  project.select(route.selected.value);
}

onMounted(() => {
  void project.loadProjects();
  if (route.selected.value) void project.loadDetail();
  connect();
  window.addEventListener('popstate', onPopState);
});
onUnmounted(() => { disconnect(); window.removeEventListener('popstate', onPopState); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" @click="navigate(null)" title="返回项目列表"><span class="brand-mark"><Terminal :size="19" /></span><span>VBEN <strong>CONTROL</strong></span></button>
      <div class="topbar-right"><span class="connection" :class="{ online: connected }"><span class="dot" />{{ connected ? 'AGENT ONLINE' : 'AGENT OFFLINE' }}</span><span class="top-separator" /><span class="top-caption">REMOTE WORKSPACE</span></div>
    </header>
    <main class="workspace">
      <div v-if="project.error.value" class="alert"><CircleAlert :size="17" />{{ project.error.value }}<button @click="project.error.value = ''" aria-label="关闭错误">×</button></div>
      <ProjectList v-if="!route.selected.value" :projects="project.projects.value" :loading="project.loading.value" :working="project.working.value" :list-branches="project.listBranches.value" @navigate="navigate" @refresh="project.loadProjects" @action="project.action" @update:branch="(name, branch) => project.listBranches.value[name] = branch" />
      <ProjectDetail v-else :selected="route.selected.value" :detail="project.detail.value" :current="project.current.value" v-model:branch="project.branch.value" :working="project.working.value" :connected="connected" @back="navigate(null)" @refresh="project.loadDetail" @action="project.action" />
    </main>
    <footer class="footer"><span>VBEN CONTROL / PERSONAL REMOTE WORKSPACE</span><span>{{ connected ? 'CONNECTED' : 'DISCONNECTED' }}</span></footer>
  </div>
</template>
