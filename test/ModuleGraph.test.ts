import { describe, it, expect } from 'vitest';
import path from 'path';
import { ModuleGraph } from '../src/ModuleGraph';
import { getModuleGraph } from '../src/index';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('ModuleGraph', () => {
  describe('parseAST', () => {
    it('should parse valid JavaScript code', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST('const x = 1;');
      expect(ast.type).toBe('File');
      expect(ast.program.type).toBe('Program');
    });

    it('should parse ES module syntax', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import foo from 'bar';");
      expect(ast.program.body).toHaveLength(1);
      expect(ast.program.body[0].type).toBe('ImportDeclaration');
    });

    it('should parse code with export declarations', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST('export const foo = 1;');
      expect(ast.program.body).toHaveLength(1);
      expect(ast.program.body[0].type).toBe('ExportNamedDeclaration');
    });
  });

  describe('extractImports', () => {
    it('should extract default import', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import foo from 'bar';");
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['default'] }]);
    });

    it('should extract named import', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import { foo } from 'bar';");
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['foo'] }]);
    });

    it('should extract named import with alias', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import { foo as bar } from 'baz';");
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([{ source: 'baz', specifiers: ['foo'] }]);
    });

    it('should extract namespace import', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import * as foo from 'bar';");
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['*'] }]);
    });

    it('should extract multiple specifiers from one import', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST("import foo, { bar, baz as qux } from 'module';");
      const imports = graph.extractImports(ast);
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
      const ast = graph.parseAST(code);
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([
        { source: 'a', specifiers: ['default'] },
        { source: 'b', specifiers: ['bar'] },
      ]);
    });

    it('should return empty array for code with no imports', () => {
      const graph = new ModuleGraph();
      const ast = graph.parseAST('const x = 1; console.log(x);');
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([]);
    });

    it('should ignore non-import statements', () => {
      const graph = new ModuleGraph();
      const code = `
import { foo } from 'bar';
const x = 1;
export default x;
      `;
      const ast = graph.parseAST(code);
      const imports = graph.extractImports(ast);
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('bar');
    });

    it('should handle string literal import name (ES2022)', () => {
      const graph = new ModuleGraph();
      // import { "foo" as bar } is ES2022 syntax
      const ast = graph.parseAST('import { "has" as foo } from "bar";');
      const imports = graph.extractImports(ast);
      expect(imports).toEqual([{ source: 'bar', specifiers: ['has'] }]);
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative path (./)', async () => {
      const graph = new ModuleGraph();
      const resolved = await graph.resolvePath('./foo', '/project/src/index.ts');
      expect(resolved).toBe('/project/src/foo');
    });

    it('should resolve relative path (../)', async () => {
      const graph = new ModuleGraph();
      const resolved = await graph.resolvePath('../foo', '/project/src/sub/index.ts');
      expect(resolved).toBe('/project/src/foo');
    });

    it('should resolve alias path', async () => {
      const graph = new ModuleGraph({
        alias: {
          '@': () => '/project/src',
        },
      });
      const resolved = await graph.resolvePath('@/utils', '/project/src/index.ts');
      expect(resolved).toBe('/project/src/utils');
    });

    it('should resolve built-in alias ~ to node_modules', async () => {
      const graph = new ModuleGraph({
        alias: {
          '~': () => '/project/node_modules',
        },
      });
      const resolved = await graph.resolvePath('~/lodash', '/project/src/index.ts');
      expect(resolved).toBe('/project/node_modules/lodash');
    });

    it('should return null for absolute path', async () => {
      const graph = new ModuleGraph();
      const resolved = await graph.resolvePath('/absolute/path', '/project/src/index.ts');
      expect(resolved).toBeNull();
    });

    it('should resolve node_modules package as leaf path', async () => {
      const graph = new ModuleGraph();
      const resolved = await graph.resolvePath('@babel/parser', '/project/src/index.ts');
      expect(resolved).toBe('node_modules/@babel/parser');
    });

    it('should resolve scoped and non-scoped node_modules packages', async () => {
      const graph = new ModuleGraph();
      const scoped = await graph.resolvePath('@babel/parser', '/project/src/index.ts');
      const normal = await graph.resolvePath('lodash', '/project/src/index.ts');
      expect(scoped).toBe('node_modules/@babel/parser');
      expect(normal).toBe('node_modules/lodash');
    });

    it('should handle non-existent node_modules package gracefully', async () => {
      const graph = new ModuleGraph();
      // node_modules packages are now leaf paths, no require.resolve involved
      const resolved = await graph.resolvePath('non-existent-package-xyz-123', '/project/src/index.ts');
      expect(resolved).toBe('node_modules/non-existent-package-xyz-123');
    });
  });

  describe('addModule', () => {
    it('should add a module and read its code', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod = await graph.addModule(modulePath);
      expect(mod.id).toBe(modulePath);
      expect(mod.code).toContain("export const foo = 'foo'");
    });

    it('should add entry point', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod = await graph.addModule(modulePath, true);
      expect(graph.entryPoints.has(mod)).toBe(true);
    });

    it('should return existing module if already added', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'foo.ts');
      const mod1 = await graph.addModule(modulePath);
      const mod2 = await graph.addModule(modulePath);
      expect(mod1).toBe(mod2);
      expect(graph.modules.size).toBe(1);
    });

    it('should recursively resolve dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule(entryPath, true);

      // entry -> foo, bar, utils
      // bar -> utils
      expect(graph.modules.size).toBe(4);

      const entryMod = graph.modules.get(entryPath)!;
      const fooMod = graph.modules.get(path.resolve(fixturesDir, 'foo.ts'))!;
      const barMod = graph.modules.get(path.resolve(fixturesDir, 'bar.ts'))!;
      const utilsMod = graph.modules.get(path.resolve(fixturesDir, 'utils.ts'))!;

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
      await graph.addModule(entryPath, true);

      const entryMod = graph.modules.get(entryPath)!;
      const utilsPath = path.resolve(fixturesDir, 'utils.ts');

      // entry imports * from utils
      expect(entryMod.importedBindings.get(utilsPath)).toEqual(new Set(['*']));
    });

    it('should handle module with no imports', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'empty.ts');
      const mod = await graph.addModule(modulePath);
      expect(mod.dependencies.size).toBe(0);
      expect(mod.importers.size).toBe(0);
      expect(mod.importedBindings.size).toBe(0);
    });

    it('should handle circular dependencies', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'circularA.ts');
      await graph.addModule(entryPath, true);

      const circA = graph.modules.get(path.resolve(fixturesDir, 'circularA.ts'))!;
      const circB = graph.modules.get(path.resolve(fixturesDir, 'circularB.ts'))!;

      // A depends on B
      expect(circA.dependencies.has(circB)).toBe(true);
      // B depends on A
      expect(circB.dependencies.has(circA)).toBe(true);
    });
    it('should treat node_modules packages as leaf nodes', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule(entryPath, true);

      const entryMod = graph.modules.get(entryPath)!;
      const extMod = graph.modules.get('node_modules/lodash')!;

      // dependency link exists
      expect(entryMod.dependencies.has(extMod)).toBe(true);
      expect(extMod.importers.has(entryMod)).toBe(true);

      // leaf node: no code, no dependencies
      expect(extMod.code).toBeUndefined();
      expect(extMod.dependencies.size).toBe(0);
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
      const resolved = await graph.resolvePath('@/utils', '/any/file.ts');
      expect(resolved).toBe(path.resolve(fixturesDir, 'src/utils'));
    });

    it('should apply built-in ~ alias by default', async () => {
      const graph = await getModuleGraph({
        files: 'empty.ts',
        cwd: fixturesDir,
      });

      // built-in ~ → <cwd>/node_modules
      const resolved = await graph.resolvePath('~/lodash', '/any/file.ts');
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

      const resolved = await graph.resolvePath('@/utils', '/any/file.ts');
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
  });

  describe('snapshot', () => {
    /** Normalize absolute paths so snapshots are portable across machines */
    const normalizePath = (str: string) =>
      str.replace(fixturesDir, '<fixtures>');

    const normalizeGraph = (graph: ModuleGraph) => {
      const result: Record<string, ReturnType<any>> = {};
      for (const [id, mod] of graph.modules) {
        const json = mod.toJSON();
        result[normalizePath(id)] = {
          ...json,
          id: normalizePath(json.id),
          dependencies: json.dependencies.map(normalizePath),
          importers: json.importers.map(normalizePath),
          importedBindings: Object.fromEntries(
            Object.entries(json.importedBindings).map(([k, v]) => [
              normalizePath(k),
              v,
            ]),
          ),
        };
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

    it('should match snapshot for module with node_modules dependency', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule(entryPath, true);

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });

    it('should match snapshot for single module with no imports', async () => {
      const graph = new ModuleGraph();
      const modulePath = path.resolve(fixturesDir, 'empty.ts');
      await graph.addModule(modulePath, true);

      expect(normalizeGraph(graph)).toMatchSnapshot();
    });
  });

  describe('ModuleNode.toJSON', () => {
    it('should serialize to JSON without circular references', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      const mod = await graph.addModule(entryPath, true);

      const json = JSON.parse(JSON.stringify(mod.toJSON()));
      expect(json.id).toBe(entryPath);
      expect(Array.isArray(json.dependencies)).toBe(true);
      expect(Array.isArray(json.importers)).toBe(true);
      expect(typeof json.importedBindings).toBe('object');
    });

    it('should serialize dependencies as id strings', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'entry.ts');
      await graph.addModule(entryPath, true);

      const entryMod = graph.modules.get(entryPath)!;
      const json = entryMod.toJSON();

      expect(json.dependencies).toEqual(
        expect.arrayContaining([
          path.resolve(fixturesDir, 'foo.ts'),
          path.resolve(fixturesDir, 'bar.ts'),
          path.resolve(fixturesDir, 'utils.ts'),
        ]),
      );
    });

    it('should serialize node_modules leaf node', async () => {
      const graph = new ModuleGraph();
      const entryPath = path.resolve(fixturesDir, 'withExternal.ts');
      await graph.addModule(entryPath, true);

      const extMod = graph.modules.get('node_modules/lodash')!;
      const json = extMod.toJSON();

      expect(json.id).toBe('node_modules/lodash');
      expect(json.dependencies).toEqual([]);
      expect(json.importers).toEqual([entryPath]);
      expect(json.importedBindings).toEqual({});
    });
  });
});
