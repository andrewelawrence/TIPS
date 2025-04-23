import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "url";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        {
          src: "manifest.json",
          dest: ".",
        },
        {
          src: "src/icons",
          dest: ".",
        },
        {
          src: "src/public/INTERPRET.txt",
          dest: ".",
        },
        {
          src: "src/public/welcome.html",
          dest: ".",
        },
        {
          src: "src/public/assets",
          dest: ".",
        },
      ],
    }),
    {
      // Doing some weird stuff here because vite kept on putting the popup html
      // into src/popup/index.html instead of popup.html (tried a host of things)
      name: "copy-popup-html",
      closeBundle: async () => {
        const srcPath = path.resolve(__dirname, "dist/src/popup/index.html");
        const destPath = path.resolve(__dirname, "dist/popup.html");

        const removeEmptyDirsRecursively = (dirPath: string) => {
          if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            if (files.length === 0) {
              fs.rmdirSync(dirPath);

              const parentDir = path.dirname(dirPath);
              const distDir = path.resolve(__dirname, "dist");

              if (parentDir.startsWith(distDir) && parentDir !== distDir) {
                removeEmptyDirsRecursively(parentDir);
              }
            }
          }
        };

        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          fs.unlinkSync(srcPath);

          const popupDir = path.dirname(srcPath);
          removeEmptyDirsRecursively(popupDir);
        } else {
          console.error("Could not find processed popup HTML at", srcPath);

          const originalSrc = path.resolve(__dirname, "src/popup/index.html");
          if (fs.existsSync(originalSrc)) {
            let content = fs.readFileSync(originalSrc, "utf-8");
            content = content.replace("./main.ts", "./assets/popup.js");

            fs.writeFileSync(destPath, content);
          }
        }
      },
    },
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "src/popup/index.html"),
        content: path.resolve(__dirname, "src/content.ts"),
        background: path.resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
});
