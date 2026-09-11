<template>
  <div class="dashboard-app">
    <slot name="header" />
    <slot name="status" />

    <main class="main-layout">
      <section class="left-section">
        <slot name="primary" />
      </section>

      <section class="right-section">
        <slot name="secondary" />
      </section>
    </main>

    <slot name="overlays" />
  </div>
</template>
