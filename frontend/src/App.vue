<script setup lang="ts">
import BuildConsole from './components/dashboard/BuildConsole.vue';
import BuildControls from './components/dashboard/BuildControls.vue';
import DashboardHeader from './components/dashboard/DashboardHeader.vue';
import DashboardStatusBar from './components/dashboard/DashboardStatusBar.vue';
import RepositoryPanel from './components/dashboard/RepositoryPanel.vue';
import ToastContainer from './components/feedback/ToastContainer.vue';
import DashboardLayout from './components/layout/DashboardLayout.vue';
import BranchPickerModal from './components/modals/BranchPickerModal.vue';
import DirtyWorkspaceModal from './components/modals/DirtyWorkspaceModal.vue';
import SettingsModal from './components/modals/SettingsModal.vue';
import { useDashboard } from './useDashboard';

const {
  abortBuild,
  autoScroll,
  branchPicker,
  buildSingle,
  buildStatus,
  buildStatusText,
  buildTimer,
  businessRepos,
  browseDirectory,
  clearConsole,
  config,
  directoryPicker,
  dirtyModal,
  fetchSingle,
  fieldErrors,
  forcePhysicalScan,
  formattedLogs,
  handleDirtyResetAndCheckout,
  handleDirtyStashAndCheckout,
  loading,
  openBranchPicker,
  pickerFilteredBranches,
  pickerLocalCount,
  pickerRemoteCount,
  repoSource,
  repos,
  saveSystemSettings,
  selectBranchAndCheckout,
  selectCurrentDirectory,
  selectedPackages,
  showSettingsModal,
  startBuild,
  toasts,
  toggleDirectoryPicker,
  toggleSelectPackage,
  updateProtectedBranches,
} = useDashboard();
</script>

<template>
  <DashboardLayout>
    <template #header>
      <DashboardHeader
        :target-repo-path="config.targetRepoPath"
        @open-settings="showSettingsModal = true"
      />
    </template>

    <template #status>
      <DashboardStatusBar
        :build-status="buildStatus"
        :build-status-text="buildStatusText"
      />
    </template>

    <template #primary>
      <BuildControls
        :business-repos="businessRepos"
        :selected-packages="selectedPackages"
        :is-running="buildStatus.status === 'running'"
        @start="startBuild"
        @abort="abortBuild"
        @toggle-package="toggleSelectPackage"
      />
      <RepositoryPanel
        :repos="repos"
        :repo-source="repoSource"
        :is-loading="loading.refresh"
        @refresh="forcePhysicalScan"
        @open-branch="openBranchPicker"
        @fetch="fetchSingle"
        @build="buildSingle"
      />
    </template>

    <template #secondary>
      <BuildConsole
        :build-status="buildStatus"
        :build-timer="buildTimer"
        :formatted-logs="formattedLogs"
        :auto-scroll="autoScroll"
        @update:auto-scroll="autoScroll = $event"
        @clear="clearConsole"
        @abort="abortBuild"
      />
    </template>

    <template #overlays>
      <BranchPickerModal
        v-if="branchPicker.show"
        :picker="branchPicker"
        :branches="pickerFilteredBranches"
        :local-count="pickerLocalCount"
        :remote-count="pickerRemoteCount"
        @close="branchPicker.show = false"
        @select="selectBranchAndCheckout"
        @update:search="branchPicker.search = $event"
        @update:tab="branchPicker.tab = $event"
      />

      <DirtyWorkspaceModal
        v-if="dirtyModal.show"
        :modal="dirtyModal"
        @close="dirtyModal.show = false"
        @stash="handleDirtyStashAndCheckout"
        @reset="handleDirtyResetAndCheckout"
      />

      <SettingsModal
        v-if="showSettingsModal"
        :config="config"
        :directory-picker="directoryPicker"
        :field-errors="fieldErrors"
        :is-saving="loading.refresh"
        @close="showSettingsModal = false"
        @save="saveSystemSettings"
        @toggle-directory-picker="toggleDirectoryPicker"
        @browse-directory="browseDirectory"
        @select-directory="selectCurrentDirectory"
        @update-protected-branches="updateProtectedBranches"
      />

      <ToastContainer :toasts="toasts" />
    </template>
  </DashboardLayout>
</template>
