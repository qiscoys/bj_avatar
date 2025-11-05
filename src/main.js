import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import { initConfig } from '@/composables/useConfig';

import '@/styles/common.css'
import '@/styles/app.scss'
import '@/styles/human.css'

import '@/utils/rem.js'

async function bootstrap() {
  // 初始化配置
  await initConfig();
  
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.mount('#app');
}

bootstrap().catch(error => {
  console.error('应用启动失败:', error);
});
