import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './'), // Adjust if your source files are in a 'src' subfolder within frontend
    }
  },
  build: {
    outDir: '../../dist/frontend', // Output build artifacts outside the src directory
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'popup/index.html'),
        content: path.resolve(__dirname, 'content.ts'),
        background: path.resolve(__dirname, 'background.ts') // Add background script entry point
      },
      output: {
        // Ensure output filenames don't have unpredictable hashes for extension loading
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  }
}) 