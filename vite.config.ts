import { builtinModules } from 'module';
import {
  type UserConfig,
  defineConfig,
} from 'vite';
import pkg from './package.json';

export default defineConfig(() => {
  const external = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
    ...Object.keys(pkg.dependencies),
  ];

  return <UserConfig>{
    build: {
      minify: false,
      lib: {
        entry: 'src/index.ts',
        formats: ['cjs', 'es'],
        fileName: (format) => format === 'cjs'
          ? 'index.js'
          : 'index.mjs',
      },
      rolldownOptions: {
        external,
      },
    },
  };
});
