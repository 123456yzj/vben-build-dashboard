import { ref } from 'vue';

function projectFromPath(): string | null {
  return decodeURIComponent(location.pathname.match(/^\/projects\/([^/]+)$/)?.[1] || '') || null;
}

export function useProjectRoute() {
  const selected = ref<string | null>(projectFromPath());

  function navigate(name: string | null) {
    selected.value = name;
    history.pushState({}, '', name ? `/projects/${encodeURIComponent(name)}` : '/');
  }

  function onPopState() {
    selected.value = projectFromPath();
  }

  return { selected, navigate, onPopState };
}
