import { describe, it, expect } from 'vitest';
import path from 'path';
import { ModuleGraph } from '../src/ModuleGraph';
import { getModuleGraph } from '../src/index';

const fixturesDir = path.resolve(__dirname, 'fixtures');

/** Access private methods for unit-testing internals */
const _priv = (graph: ModuleGraph) => graph as unknown as {
  parseAST: typeof graph['parseAST'];
  extractImports: typeof graph['extractImports'];
  resolveId: typeof graph['resolveId'];
  resolveAlias: typeof graph['resolveAlias'];
};

describe('ModuleGraph', () => {
  describe('parseAST', () => {
    it('should parse valid JavaScript code', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST('const x = 1;');
      expect(ast.type).toBe('File');
      expect(ast.program.type).toBe('Program');
    });

    it('should parse ES module syntax', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import foo from 'bar';");
      expect(ast.program.body).toHaveLength(1);
      expect(ast.program.body[0].type).toBe('ImportDeclaration');
    });

    it('should parse code with export declarations', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST('export const foo = 1;');
      expect(ast.program.body).toHaveLength(1);
      expect(ast.program.body[0].type).toBe('ExportNamedDeclaration');
    });
  });

  describe('extractImports', () => {
    it('should extract default import', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import foo from 'bar';");
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['default'] }]);
    });

    it('should extract named import', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import { foo } from 'bar';");
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['foo'] }]);
    });

    it('should extract named import with alias', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import { foo as bar } from 'baz';");
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{ source: 'baz', specifiers: ['foo'] }]);
    });

    it('should extract namespace import', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import * as foo from 'bar';");
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['*'] }]);
    });

    it('should extract multiple specifiers from one import', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST("import foo, { bar, baz as qux } from 'module';");
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{
        source: 'module',
        specifiers: ['default', 'bar', 'baz'],
      }]);
    });

    it('should extract multiple import declarations', () => {
      const graph = new ModuleGraph();
      const code = `
import foo from 'a';
import { bar } from 'b';
      `;
      const ast = _priv(graph).parseAST(code);
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([
        { source: 'a', specifiers: ['default'] },
        { source: 'b', specifiers: ['bar'] },
      ]);
    });

    it('should return empty array for code with no imports', () => {
      const graph = new ModuleGraph();
      const ast = _priv(graph).parseAST('const x = 1; console.log(x);');
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([]);
    });

    it('should ignore non-import statements', () => {
      const graph = new ModuleGraph();
      const code = `
import { foo } from 'bar';
const x = 1;
export default x;
      `;
      const ast = _priv(graph).parseAST(code);
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('bar');
    });

    it('should handle string literal import name (ES2022)', () => {
      const graph = new ModuleGraph();
      // import { "foo" as bar } is ES2022 syntax
      const ast = _priv(graph).parseAST('import { "has" as foo } from "bar";');
      const imports = _priv(graph).extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['has'] }]);
    });
  });

  describe('resolveId', () => {
    it('should resolve relative path with extension', async () => {
      const graph = new ModuleGraph();
      const importer = path.resolve(fixturesDir, 'entry.ts');
      const resolved = await _priv(graph).resolveId('./foo.ts', importer);
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should resolve relative path without extension (auto-append)', async () => {
      const graph = new ModuleGraph();
      const importer = path.resolve(fixturesDir, 'entry.ts');
      const resolved = await _priv(graph).resolveId('./foo', importer);
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should resolve relative path (../)', async () => {
      const graph = new ModuleGraph();
      const importer = path.resolve(fixturesDir, 'entry.ts');
      const resolved = await _priv(graph).resolveId('./utils', importer);
      expect(resolved).toBe(path.resolve(fixturesDir, 'utils.ts'));
    });

    it('should resolve alias path with real file', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => fixturesDir,
        },
      });
      const resolved = await _priv(graph).resolveId('@/foo.ts');
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should resolve alias path without extension (auto-append)', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => fixturesDir,
        },
      });
      const resolved = await _priv(graph).resolveId('@/foo');
      expect(resolved).toBe(path.resolve(fixturesDir, 'foo.ts'));
    });

    it('should return null for non-existent path', async () => {
      const graph = new ModuleGraph();
      const resolved = await _priv(graph).resolveId('/non/existent/path');
      expect(resolved).toBeNull();
    });

    it('should resolve node_modules package as leaf path', async () => {
      const graph = new ModuleGraph();
      const resolved = await _priv(graph).resolveId('@babel/parser', '/project/src/index.ts');
      expect(resolved).toBe('node_modules/@babel/parser');
    });

    it('should resolve scoped and non-scoped node_modules packages', async () => {
      const graph = new ModuleGraph();
      const scoped = await _priv(graph).resolveId('@babel/parser', '/project/src/index.ts');
      const normal = await _priv(graph).resolveId('lodash', '/project/src/index.ts');
      expect(scoped).toBe('node_modules/@babel/parser');
      expect(normal).toBe('node_modules/lodash');
    });

    it('should handle non-existent node_modules package gracefully', async () => {
      const graph = new ModuleGraph();
      const resolved = await _priv(graph).resolveId('non-existent-package-xyz-123', '/project/src/index.ts');
      expect(resolved).toBe('node_modules/non-existent-package-xyz-123');
    });
  });

  describe('resolveAlias', () => {
    it('should resolve alias prefix', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => '/project/src',
        },
      });
      const resolved = await _priv(graph).resolveAlias('@/utils');
      expect(resolved).toBe('/project/src/utils');
    });

    it('should resolve ~ alias', async () => {
      const graph = new ModuleGraph({
        alias: {
          '~': () => '/project/node_modules',
        },
      });
      const resolved = await _priv(graph).resolveAlias('~/lodash');
      expect(resolved).toBe('/project/node_modules/lodash');
    });

    it('should return null for non-alias path', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => '/project/src',
        },
      });
      const resolved = await _priv(graph).resolveAlias('./foo');
      expect(resolved).toBeNull();
    });

    it('should not match scoped package as alias', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => '/project/src',
        },
      });
      // @babel/parser is NOT @/babel/parser — no slash after @
      const resolved = await _priv(graph).resolveAlias('@babel/parser');
      expect(resolved).toBeNull();
    });
  });

  describe('addModule', () => {
    it('should add a module and read its code', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod = await graph.addModule({ id: modulePath, rawId: modulePath });
      expect(mod).not.toBeNull();
      expect(mod!.id).toBe(modulePath);
      expect(mod!.rawId).toBe(modulePath);
      expect(mod!.code).toContain("export const foo = 'foo'");
    });

    it('should add entry point', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod = await graph.addModule({ id: modulePath, rawId: modulePath, isEntry: true });
      expect(mod).not.toBeNull();
      expect(graph.entryPoints.has(mod!)).toBe(true);
    });

    it('should return existing module if already added', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod1 = await graph.addModule({ id: modulePath, rawId: modulePath });
      const mod2 = await graph.addModule({ id: modulePath, rawId: modulePath });
      expect(mod1).toBe(mod2);
      expect(graph.modules.size).toBe(1);
    });

    it('should throw for non-existent file', async () => {
      const graph = new ModuleGraph();
      await expect(
        graph.addModule({ id: '/non/existent/file.ts', rawId: '/non/existent/file.ts' }),
      ).rejects.toThrow();
    });

    it('should recursively resolve dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      // entry -> foo, bar, utils; bar -> utils
      // modules keyed by resolvedId (absolute paths)
      const fooPath = path.resolve(fixturesDir, 'foo.ts');
      const barPath = path.resolve(fixturesDir, 'bar.ts');
      const utilsPath = path.resolve(fixturesDir, 'utils.ts');

      expect(graph.modules.size).toBe(4);

      const entryMod = graph.modules.get(entryPath)!;
      const fooMod = graph.modules.get(fooPath)!;
      const barMod = graph.modules.get(barPath)!;
      const utilsMod = graph.modules.get(utilsPath)!;

      // entry depends on foo, bar, utils
      expect(entryMod.dependencies.has(fooMod)).toBe(true);
      expect(entryMod.dependencies.has(barMod)).toBe(true);
      expect(entryMod.dependencies.has(utilsMod)).toBe(true);

      // foo, bar, utils are imported by entry
      expect(fooMod.importers.has(entryMod)).toBe(true);
      expect(barMod.importers.has(entryMod)).toBe(true);
      expect(utilsMod.importers.has(entryMod)).toBe(true);

      // bar depends on utils
      expect(barMod.dependencies.has(utilsMod)).toBe(true);
      expect(utilsMod.importers.has(barMod)).toBe(true);
    });

    it('should track imported bindings', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const entryMod = graph.modules.get(entryPath)!;

      // entry imports * from utils (rawId = './utils.ts')
      const binding = entryMod.importedBindings.get('./utils.ts');
      expect(binding).toBeDefined();
      expect(binding!.specifiers).toEqual(new Set(['*']));
    });

    it('should handle module with no imports', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'empty.ts');
      const mod = await graph.addModule({ id: modulePath, rawId: modulePath });
      expect(mod).not.toBeNull();
      expect(mod!.dependencies.size).toBe(0);
      expect(mod!.importers.size).toBe(0);
      expect(mod!.importedBindings.size).toBe(0);
    });

    it('should handle circular dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const circAPath = path.resolve(fixturesDir, 'circularA.ts');
      const circBPath = path.resolve(fixturesDir, 'circularB.ts');

      const circA = graph.modules.get(circAPath)!;
      const circB = graph.modules.get(circBPath)!;

      // A depends on B
      expect(circA.dependencies.has(circB)).toBe(true);
      // B depends on A
      expect(circB.dependencies.has(circA)).toBe(true);
    });

    it('should treat node_modules packages as leaf nodes', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const entryMod = graph.modules.get(entryPath)!;
      const extMod = graph.modules.get('node_modules/lodash')!;

      // dependency link exists
      expect(entryMod.dependencies.has(extMod)).toBe(true);
      expect(extMod.importers.has(entryMod)).toBe(true);

      // leaf node: no code, no dependencies
      expect(extMod.code).toBeUndefined();
      expect(extMod.dependencies.size).toBe(0);
    });

    it('should resolve alias entry path', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => fixturesDir,
        },
      });
      const id = await _priv(graph).resolveId('@/foo.ts');
      expect(id).not.toBeNull();
      const mod = await graph.addModule({ id: id!, rawId: '@/foo.ts', isEntry: true });

      const fooPath = path.resolve(fixturesDir, 'foo.ts');
      expect(mod).not.toBeNull();
      expect(mod!.id).toBe(fooPath);
      expect(mod!.rawId).toBe('@/foo.ts');
      expect(graph.modules.has(fooPath)).toBe(true);
      expect(graph.entryPoints.has(mod!)).toBe(true);
    });
  });

  describe('getModuleGraph', () => {
    it('should build graph from absolute file path', async () => {
      const entryPath = path.resolve(fixturesDir, 'foo.ts');
      const graph = await getModuleGraph({ files: entryPath });

      expect(graph.modules.has(entryPath)).toBe(true);
      expect(graph.entryPoints.size).toBe(1);
    });

    it('should build graph from relative file path with cwd', async () => {
      const graph = await getModuleGraph({
        files: 'foo.ts',
        cwd: fixturesDir,
      });

      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      expect(graph.modules.has(modulePath)).toBe(true);
    });

    it('should build graph from multiple entry files', async () => {
      const graph = await getModuleGraph({
        files: ['foo.ts', 'empty.ts'],
        cwd: fixturesDir,
      });

      expect(graph.entryPoints.size).toBe(2);
      expect(graph.modules.size).toBeGreaterThanOrEqual(2);
    });

    it('should apply built-in @ alias by default', async () => {
      const graph = await getModuleGraph({
        files: 'empty.ts',
        cwd: fixturesDir,
      });

      // built-in @ → <cwd>/src
      const resolved = await _priv(graph).resolveAlias('@/utils');
      expect(resolved).toBe(path.resolve(fixturesDir, 'src/utils'));
    });

    it('should apply built-in ~ alias by default', async () => {
      const graph = await getModuleGraph({
        files: 'empty.ts',
        cwd: fixturesDir,
      });

      // built-in ~ → <cwd>/node_modules
      const resolved = await _priv(graph).resolveAlias('~/lodash');
      expect(resolved).toBe(path.resolve(fixturesDir, 'node_modules/lodash'));
    });

    it('should allow custom alias to override built-in', async () => {
      const customSrc = path.resolve(fixturesDir, 'custom-src');
      const graph = await getModuleGraph({
        files: 'empty.ts',
        cwd: fixturesDir,
        alias: {
          '@': () => customSrc,
        },
      });

      const resolved = await _priv(graph).resolveAlias('@/utils');
      expect(resolved).toBe(path.resolve(customSrc, 'utils'));
    });

    it('should recursively resolve dependencies from entry', async () => {
      const graph = await getModuleGraph({
        files: 'entry.ts',
        cwd: fixturesDir,
      });

      // entry -> foo, bar, utils; bar -> utils
      expect(graph.modules.size).toBe(4);
    });

    it('should skip non-existent entry file silently', async () => {
      const graph = await getModuleGraph({
        files: 'non-existent.ts',
        cwd: fixturesDir,
      });

      expect(graph.modules.size).toBe(0);
      expect(graph.entryPoints.size).toBe(0);
    });
  });

  describe('snapshot', () => {
    /** Normalize absolute paths so snapshots are portable across machines */
    const normalizePath = (str: string) =>
      str.replace(fixturesDir, '<fixtures>');

    const normalizeNode = (json: any): any => {
      const result: any = {
        id: normalizePath(json.id),
        rawId: normalizePath(json.rawId),
      };
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
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });

    it('should match snapshot for circular dependency graph', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });

    it('should match snapshot for module with node_modules dependency', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });

    it('should match snapshot for single module with no imports', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'empty.ts');
      await graph.addModule({ id: modulePath, rawId: modulePath, isEntry: true });

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });
  });

  describe('ModuleNode.toJSON', () => {
    it('should serialize to JSON without circular references', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      const mod = await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const json = JSON.parse(JSON.stringify(mod!.toJSON()));
      expect(json.id).toBe(entryPath);
      expect(json.rawId).toBe(entryPath);
      expect(typeof json.dependencies).toBe('object');
      expect(json.dependencies).not.toBeNull();
    });

    it('should serialize dependencies recursively as object keyed by rawId', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const entryMod = graph.modules.get(entryPath)!;
      const json = entryMod.toJSON();

      // dependencies is an object keyed by rawId (import source)
      expect(typeof json.dependencies).toBe('object');
      expect(Object.keys(json.dependencies)).toEqual(
        expect.arrayContaining(['./foo.ts', './bar.ts', './utils.ts']),
      );

      // each dependency has nested structure
      const barDep = json.dependencies['./bar.ts'];
      expect(barDep.id).toBe(path.resolve(fixturesDir, 'bar.ts'));
      expect(barDep.rawId).toBe('./bar.ts');
      // bar -> utils: nested dependency
      expect(typeof barDep.dependencies).toBe('object');
      expect(barDep.dependencies['./utils.ts']).toBeDefined();
    });

    it('should mark circular dependencies with _circular flag', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const circA = graph.modules.get(entryPath)!;
      const json = circA.toJSON();

      // circularA -> circularB -> circularA: the nested circularA should have _circular flag
      const circBDep = json.dependencies['./circularB.ts'];
      expect(circBDep).toBeDefined();
      // circularB depends on circularA, which should be marked _circular
      // Note: circularA's rawId is the absolute path because it was added as entry
      const circADepInB = circBDep.dependencies[entryPath];
      expect(circADepInB._circular).toBe(true);
    });

    it('should serialize node_modules leaf node', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule({ id: entryPath, rawId: entryPath, isEntry: true });

      const extMod = graph.modules.get('node_modules/lodash')!;
      const json = extMod.toJSON();

      expect(json.id).toBe('node_modules/lodash');
      expect(json.rawId).toBe('lodash');
      expect(json.dependencies).toEqual({});
    });
  });
});