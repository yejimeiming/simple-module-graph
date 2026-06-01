import { describe, it, expect } from 'vitest';
import path from 'path';
import { ModuleGraph } from '../src/ModuleGraph';
import { getModuleGraph } from '../src/index';

const fixturesDir = path.resolve(__dirname, 'fixtures');

/** Access private methods for unit-testing internals */
const _priv = (graph: ModuleGraph) => graph as unknown as {
  parseAST: typeof graph['parseAST'];
  extractImports: typeof graph['extractImports'];
  resolveAlias: typeof graph['resolveAlias'];
};

describe('ModuleGraph', () => {
  describe('parseAST', () => {
    it('should parse ES module syntax', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import foo from 'bar';");
      expect(ast.program.body).toHaveLength(1);
      expect(ast.program.body[0].type).toBe('ImportDeclaration');
    });
  });

  describe('extractImports', () => {
    it('should extract multiple specifiers from one import', () => {
      const graph = new ModuleGraph();
      const code = "import foo, { bar, baz as qux } from 'module';";
      const ast = _priv(graph).parseAST(code);
      const imports = _priv(graph).extractImports(ast, code);
      expect(imports[0].source).toBe('module');
      expect(imports[0].specifiers).toEqual(['default', 'bar', 'baz']);
    });

    it('should return empty array for code with no imports', () => {
      const graph = new ModuleGraph();
      const code = 'const x = 1; console.log(x);';
      const ast = _priv(graph).parseAST(code);
      const imports = _priv(graph).extractImports(ast, code);
      expect(imports).toEqual([]);
    });
  });

  describe('resolveId', () => {
    it('should resolve relative path without extension (auto-append)', async () => {
      const graph = new ModuleGraph();
      const importer = path.resolve(fixturesDir, 'entry.ts');
      const resolved = await graph.resolveId('./foo', importer);
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should resolve alias path without extension (auto-append)', async () => {
      const graph = new ModuleGraph({
        alias: { '@': () => fixturesDir },
      });
      const resolved = await graph.resolveId('@/foo');
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should resolve node_modules package as leaf path', async () => {
      const graph = new ModuleGraph();
      const resolved = await graph.resolveId('@babel/parser', '/project/src/index.ts');
      expect(resolved).toBe('node_modules/@babel/parser');
    });
  });

  describe('resolveAlias', () => {
    it('should resolve alias prefix', async () => {
      const graph = new ModuleGraph({
        alias: { '@': () => '/project/src' },
      });
      const resolved = await _priv(graph).resolveAlias('@/utils');
      expect(resolved).toBe('/project/src/utils');
    });

    it('should not match scoped package as alias', async () => {
      const graph = new ModuleGraph({
        alias: { '@': () => '/project/src' },
      });
      const resolved = await _priv(graph).resolveAlias('@babel/parser');
      expect(resolved).toBeNull();
    });
  });

  describe('addModule', () => {
    it('should recursively resolve dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule(entryPath, true);

      const fooPath = path.resolve(fixturesDir, 'foo.ts');
      const barPath = path.resolve(fixturesDir, 'bar.ts');
      const utilsPath = path.resolve(fixturesDir, 'utils.ts');

      expect(graph.modules.size).toBe(4);

      const entryMod = graph.modules.get(entryPath)!;
      const fooMod = graph.modules.get(fooPath)!;
      const barMod = graph.modules.get(barPath)!;
      const utilsMod = graph.modules.get(utilsPath)!;

      expect(entryMod.dependencies.has(fooMod)).toBe(true);
      expect(entryMod.dependencies.has(barMod)).toBe(true);
      expect(entryMod.dependencies.has(utilsMod)).toBe(true);
      expect(fooMod.importers.has(entryMod)).toBe(true);
      expect(barMod.dependencies.has(utilsMod)).toBe(true);
      expect(utilsMod.importers.has(barMod)).toBe(true);
    });

    it('should return existing module if already added', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod1 = await graph.addModule(modulePath);
      const mod2 = await graph.addModule(modulePath);
      expect(mod1).toBe(mod2);
      expect(graph.modules.size).toBe(1);
    });

    it('should handle circular dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule(entryPath, true);

      const circA = graph.modules.get(entryPath)!;
      const circB = graph.modules.get(path.resolve(fixturesDir, 'circularB.ts'))!;

      expect(circA.dependencies.has(circB)).toBe(true);
      expect(circB.dependencies.has(circA)).toBe(true);
    });

    it('should treat node_modules packages as leaf nodes', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule(entryPath, true);

      const entryMod = graph.modules.get(entryPath)!;
      const extMod = graph.modules.get('node_modules/lodash')!;

      expect(entryMod.dependencies.has(extMod)).toBe(true);
      expect(extMod.importers.has(entryMod)).toBe(true);
      expect(extMod.code).toBeUndefined();
      expect(extMod.dependencies.size).toBe(0);
    });
  });

  describe('getModuleGraph', () => {
    it('should build graph from relative file path with cwd', async () => {
      const graph = await getModuleGraph({
        files: 'foo.ts',
        cwd: fixturesDir,
      });

      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      expect(graph.modules.has(modulePath)).toBe(true);
    });

    it('should recursively resolve dependencies from entry', async () => {
      const graph = await getModuleGraph({
        files: 'entry.ts',
        cwd: fixturesDir,
      });

      expect(graph.modules.size).toBe(4);
    });

    it('should allow custom alias to override built-in', async () => {
      const customSrc = path.resolve(fixturesDir, 'custom-src');
      const graph = await getModuleGraph({
        files: 'empty.ts',
        cwd: fixturesDir,
        alias: { '@': () => customSrc },
      });

      const resolved = await _priv(graph).resolveAlias('@/utils');
      expect(resolved).toBe(path.resolve(customSrc, 'utils'));
    });
  });

  describe('snapshot', () => {
    /** Normalize absolute paths so snapshots are portable across machines */
    const normalizePath = (str: string) =>
      str.replace(fixturesDir, '<fixtures>');

    const normalizeNode = (json: any): any => {
      const result: any = {};
      if (json.dependencies && Object.keys(json.dependencies).length > 0) {
        result.dependencies = Object.fromEntries(
          Object.entries(json.dependencies).map(([k, v]) => [normalizePath(k), normalizeNode(v)]),
        );
      }
      if (json._circular) {
        result._circular = true;
      }
      if (json.error) {
        result.error = json.error;
      }
      return result;
    };

    const normalizeGraph = (graph: ModuleGraph) => {
      const result: Record<string, any> = {};
      for (const [id, mod] of graph.modules) {
        result[normalizePath(id)] = normalizeNode(mod.toJSON());
      }
      return result;
    };

    it('should match snapshot for entry dependency graph', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule(entryPath, true);

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });

    it('should match snapshot for circular dependency graph', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule(entryPath, true);

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });
  });

  describe('ModuleNode.toJSON', () => {
    it('should mark circular dependencies with _circular flag', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule(entryPath, true);

      const circA = graph.modules.get(entryPath)!;
      const json = circA.toJSON();

      const circBPath = path.resolve(fixturesDir, 'circularB.ts');
      const circADepInB = json.dependencies[circBPath].dependencies[entryPath];
      expect(circADepInB._circular).toBe(true);
    });

    it('should serialize node_modules leaf node', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule(entryPath, true);

      const extMod = graph.modules.get('node_modules/lodash')!;
      const json = extMod.toJSON();

      expect(json.dependencies).toEqual({});
    });
  });
});
