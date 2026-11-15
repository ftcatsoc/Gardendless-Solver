import {defineConfig} from 'vite';
const base = process.env.PAGES_BASE || '/';
export default defineConfig({base, worker: {format: 'es'}, build: {
  target: 'es2022',
  ...(process.env.PVZ_QA === '1' ? {outDir: 'temp/qa-dist',
    rolldownOptions: {input: {main: 'index.html', qa: 'qa.html'}}} : {})
}});
