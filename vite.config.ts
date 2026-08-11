import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Uma unica instancia de three no bundle. Sem isto, o globe.gl traz a copia
  // dele e os objetos criados aqui sao renderizados por outro renderer, o que
  // quebra com erros do tipo "determinantAffine is not a function".
  resolve: { dedupe: ["three"] },
  optimizeDeps: { include: ["three"] },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } },
  },
});
