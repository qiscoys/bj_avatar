<script setup>
defineProps({
  visible: {
    // 加载中动画可见性
    type: Boolean,
    default: true,
  },
});
</script>

<template>
  <div class="overlay overlay--loader overlay--active" v-show="visible">
    <div class="loader">
      <div></div>
      <div></div>
      <div></div>
    </div>
    <p>首次加载预计需要1分钟</p>
  </div>
</template>

<style lang="scss" scoped>
.overlay {
  position: fixed;
  z-index: 10;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 1;

  p {
    margin-top: 2rem;
    color: #fff;
  }
}

.overlay--loader {
  z-index: 1000;
  background: rgba(0, 0, 0, 0.3);
}

</style>
