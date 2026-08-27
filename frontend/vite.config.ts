import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 环境变量只认仓库根的 .env（AGENTS.md 硬性约定），不向前端目录复制。
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  envDir: repoRoot,
  plugins: [react()],
  server: {
    proxy: {
      // 本机联调：前端只走相对路径 /api，由 Vite 代理到 FastAPI，不扩大 CORS。
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
