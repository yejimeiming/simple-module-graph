export * from './types';
export * from './ModuleGraph';

import path from 'path';

import type { GetModuleGraphOptions, ModuleGraphOptions } from './types';
import { ModuleGraph } from './ModuleGraph';

/** 内置主流 alias 约定: @ → <cwd>/src, ~ → <cwd>/node_modules */
const BUILTIN_ALIAS: Record<string, (cwd: string) => string> = {
  '@': (cwd) => path.resolve(cwd, 'src'),
  '~': (cwd) => path.resolve(cwd, 'node_modules'),
};

function createDefaultAlias(cwd: string): Record<string, () => string> {
  const alias: Record<string, () => string> = {};
  for (const [key, resolve] of Object.entries(BUILTIN_ALIAS)) {
    alias[key] = () => resolve(cwd);
  }
  return alias;
}

export async function getModuleGraph(options: GetModuleGraphOptions) {
  const {
    files,
    cwd = process.cwd(),
    alias: customAlias,
  } = options;

  const alias: ModuleGraphOptions['alias'] = {
    ...createDefaultAlias(cwd),
    ...customAlias,
  };

  const graph = new ModuleGraph({ alias });

  const entryFiles = Array.isArray(files) ? files : [files];
  for (const file of entryFiles) {
    const filePath = path.isAbsolute(file) ? file : path.resolve(cwd, file);
    await graph.addModule(filePath, true);
  }

  return graph;
}
