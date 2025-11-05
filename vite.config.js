import { fileURLToPath, URL } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyPort = Number(env.PROXY_PORT || 3001);
  return {
  // 使构建后的资源路径相对，适配子路径/本地文件打开
  base: './',
  esbuild: {
    target: 'es2020'
  },
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
      dts: false,
      eslintrc: {
        enabled: false,
      },
    }),
    {
      name: 'configure-server-cache', // 插件名称
      configureServer(server) {
        console.log('配置开发服务器缓存策略');
        server.middlewares.use((req, res, next) => {
          // 对图片资源设置 1 小时缓存
          if (/\.(png|jpe?g|gif|webp)$/i.test(req.url)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
          // 对音视频资源设置 10 小时缓存
          else if (/\.(mp4|webm|mp3|ogg)$/i.test(req.url)) {
            res.setHeader('Cache-Control', 'public, max-age=36000');
          }
          // 其他资源禁用强缓存
          else {
            res.setHeader('Cache-Control', 'no-cache');
          }
          next(); // 继续处理请求
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    open: true,
    proxy: {
      '/asr': {
        target: `http://localhost:${proxyPort}`,
        changeOrigin: true,
        ws: true,
      },
      '/tts-ws': {
        target: `http://localhost:${proxyPort}`,
        changeOrigin: true,
        ws: true,
      },
      '/tts-proxy': {
        target: `http://localhost:${proxyPort}`,
        changeOrigin: true,
        ws: true,
      },
      // 代理支付查询接口
      '/api/payment': {
        target: 'http://wapbj.189.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/payment/, '/wap2017/re/wapFree/rest/500/payResultSZR')
      }
    },
  },
};
});
