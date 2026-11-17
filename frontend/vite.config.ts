import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 画面（5173番）から /api へのアクセスを、バックエンド（8000番）へ中継する
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
