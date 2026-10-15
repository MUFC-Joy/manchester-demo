import { defineConfig } from 'vite'

export default defineConfig({
  // 相对路径，GitHub Pages 子目录部署也能直接用
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
})
