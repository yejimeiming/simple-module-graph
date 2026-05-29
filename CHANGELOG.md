# Changelog

## v0.1.0(2026/05/29)

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
