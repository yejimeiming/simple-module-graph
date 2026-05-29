# simple-module-graph

一个简单的 `ModuleGraph` 库, 灵感来自 Rollup

## Install

```bash
npm install simple-module-graph
```

## Usage

### `getModuleGraph`

最简单的使用方式，传入入口文件即可自动构建依赖图：

```ts
import { getModuleGraph } from 'simple-module-graph';

const graph = await getModuleGraph({
  files: './src/index.ts',
});

// 遍历所有模块
for (const [id, mod] of graph.modules) {
  console.log(id);
  console.log('  dependencies:', [...mod.dependencies].map((d) => d.id));
  console.log('  importers:', [...mod.importers].map((d) => d.id));
  console.log('  importedBindings:', Object.fromEntries(mod.importedBindings));
}

// 获取入口模块
for (const entry of graph.entryPoints) {
  console.log('entry:', entry.id);
}
```

支持多个入口文件：

```ts
const graph = await getModuleGraph({
  files: ['./src/index.ts', './src/server.ts'],
});
```

### `ModuleGraph`

也可以直接使用 `ModuleGraph` 类，获得更细粒度的控制：

```ts
import { ModuleGraph } from 'simple-module-graph';

const graph = new ModuleGraph();

// 添加模块（自动递归解析依赖）
const mod = await graph.addModule('/path/to/file.ts', true /* isEntry */);

// 解析路径
const resolved = await graph.resolvePath('./utils', '/path/to/file.ts');
// => '/path/to/utils'

// 解析 AST
const ast = graph.parseAST('import foo from "bar";');

// 提取导入信息
const imports = graph.extractImports(ast);
// => [{ source: 'bar', specifiers: ['default'] }]
```

### Alias

`getModuleGraph` 内置了两个常用别名：

| 别名 | 解析路径 |
|------|----------|
| `@` | `<cwd>/src` |
| `~` | `<cwd>/node_modules` |

自定义别名会覆盖内置别名：

```ts
const graph = await getModuleGraph({
  files: './src/index.ts',
  alias: {
    '@': () => '/project/packages/src',
    '#': () => '/project/shared',
  },
});
```

### node_modules

第三方依赖（`node_modules`）作为叶子节点处理，只记录依赖关系，不会深入解析：

```ts
const graph = await getModuleGraph({ files: './src/index.ts' });

// node_modules 模块以 'node_modules/' 为前缀
const lodashMod = graph.modules.get('node_modules/lodash');
console.log(lodashMod?.dependencies.size); // 0 — 叶子节点无依赖
```

### JSON 序列化

模块节点支持 `toJSON()`，可安全序列化（无循环引用）：

```ts
const graph = await getModuleGraph({ files: './src/index.ts' });

for (const [id, mod] of graph.modules) {
  console.log(JSON.stringify(mod.toJSON(), null, 2));
}
```

## API

### `getModuleGraph(options)`

返回 `Promise<ModuleGraph>`。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `files` | `string \| string[]` | — | 入口文件路径，支持相对或绝对路径 |
| `cwd` | `string` | `process.cwd()` | 项目根目录 |
| `alias` | `Record<string, () => string>` | 内置 `@` 和 `~` | 自定义别名，覆盖内置 |

### `ModuleGraph`

| 属性/方法 | 说明 |
|-----------|------|
| `modules` | `Map<string, ModuleNode>` — 所有模块 |
| `entryPoints` | `Set<ModuleNode>` — 入口模块 |
| `addModule(id, isEntry?)` | 添加模块，递归解析依赖 |
| `resolvePath(source, importer)` | 解析导入路径 |
| `parseAST(code)` | 解析代码为 AST |
| `extractImports(ast)` | 从 AST 提取导入信息 |

### `ModuleNode`

| 属性 | 说明 |
|------|------|
| `id` | 模块唯一标识（文件绝对路径） |
| `code` | 源码内容（node_modules 叶子节点无此属性） |
| `ast` | Babel AST |
| `dependencies` | `Set<ModuleNode>` — 当前模块依赖的模块 |
| `importers` | `Set<ModuleNode>` — 依赖当前模块的模块 |
| `importedBindings` | `Map<string, Set<string>>` — 具体导入的变量 |
| `toJSON()` | 安全序列化（Set/Map → Array/Object，无循环引用） |
