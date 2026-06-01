# Changelog

## v0.3.1 (2026/06/01)

- Fix README API docs: `resolvePath` → `resolveId`, `extractImports(ast)` → `extractImports(ast, code)`, add type column and missing public methods
- Streamline test suite: 39 → 19 cases, removing redundant coverage

## v0.3.0 (2026/05/30)

- **Public `resolveId` API**: expose `ModuleGraph.resolveId(source, importer?)` for external path resolution
- **Smarter path resolution**: auto-resolve file extensions (`extensions` option) and `index` files; support bare-specifier entry files
- **`cwd` option**: `ModuleGraphOptions.cwd` defaults to `process.cwd()`, used consistently across resolution
- **Richer `importedBindings`**: each binding now stores `{ id, specifiers, importee }` instead of a flat `Set<string>`
- **`ImportInfo` type**: new exported interface describing a single import declaration
- **`ModuleNode.error`**: track per-module parse / resolve errors
- **`ModuleNode.rawId`**: store the original import specifier (marked `@deprecated` — ambiguous for relative paths)
- **`code` / `ast` made optional**: `ModuleNode.code` and `ModuleNode.ast` are now `T | undefined`
- **`getModuleGraph` entry resolution**: resolve entry file paths via `resolveId` before adding to graph

## v0.2.0 (2026/05/29)

- Add `ModuleGraph.toJSON()` for debugging and serialization
- Encapsulate internal APIs as `private`: `resolveDependencies`, `parseAST`, `extractImports`, `resolvePath`, `alias`
- Explicitly mark public API: `modules`, `entryPoints`, `addModule`

## v0.1.0 (2026/05/29)

Initial release.

- `ModuleGraph` class for building JS/TS module dependency graphs
  - Parse static `import` declarations via Babel
  - Track `dependencies`, `importers`, and `importedBindings` per module
  - `toJSON()` serialization for snapshot testing
- `getModuleGraph()` convenience API
  - Built-in alias conventions: `@` → `<cwd>/src`, `~` → `<cwd>/node_modules`
  - Custom alias support
  - Multiple entry files
- Path resolution: relative paths, aliases, and `node_modules` (leaf-node model)
- Dual CJS/ESM output
