# simple-module-graph

一个简单的 `ModuleGraph` 库，灵感来自 Rollup

## Install

```bash
npm install simple-module-graph
```

## Usage

```ts
import { getModuleGraph } from 'simple-module-graph';

const graph = await getModuleGraph({ files: './src/index.ts' });

for (const [id, mod] of graph.modules) {
  console.log(id);
  console.log('  dependencies:', [...mod.dependencies].map((d) => d.id));
  console.log('  importers:', [...mod.importers].map((d) => d.id));
}
```

支持多个入口：

```ts
const graph = await getModuleGraph({ files: ['./src/index.ts', './src/server.ts'] });
```

### Alias

内置别名 `@` → `<cwd>/src`，`~` → `<cwd>/node_modules`，可自定义覆盖：

```ts
const graph = await getModuleGraph({
  files: './src/index.ts',
  alias: { '@': () => '/project/packages/src' },
});
```

### node_modules

第三方依赖作为叶子节点，仅记录依赖关系不深入解析，ID 以 `node_modules/` 为前缀。

## API

### `getModuleGraph(options)`

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `files` | `string \| string[]` | — | 入口文件路径 |
| `cwd` | `string` | `process.cwd()` | 项目根目录 |
| `alias` | `Record<string, () => string>` | 内置 `@` 和 `~` | 自定义别名 |

### `ModuleGraph`

| 属性/方法 | 类型 | 说明 |
|-----------|------|------|
| `modules` | `Map<string, ModuleNode>` | 所有模块（key 为解析后的绝对路径） |
| `entryPoints` | `Set<ModuleNode>` | 入口模块 |
| `toJSON()` | `() => object` | 序列化图结构，方便调试输出 |
| `addModule(id, isEntry?)` | `(string, boolean?) => Promise<ModuleNode \| null>` | 添加模块，递归解析依赖 |
| `resolveId(source, importer?)` | `(string, string?) => Promise<string \| null>` | 解析导入路径（相对/alias/node_modules） |
| `resolveDependencies(module)` | `(ModuleNode) => Promise<void>` | 解析模块的所有依赖并建立双向连接 |
| `resolveAlias(source)` | `(string) => Promise<string \| null>` | 别名前缀匹配解析 |
| `resolveEntryFile(source)` | `(string) => Promise<string \| null>` | 基于 cwd 解析入口文件 |
| `tryResolveWithExt(source)` | `(string) => Promise<string \| null>` | 自动补全扩展名解析 |
| `parseAST(code)` | `(string) => BabelStyleAST` | 解析代码为 Babel AST |
| `extractImports(ast, code)` | `(BabelStyleAST, string) => ImportInfo[]` | 从 AST 提取导入信息 |

### `ModuleNode`

| 属性 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 模块唯一标识（文件绝对路径或 `node_modules/*`） |
| `rawId` | `string \| undefined` | 原始 id（已废弃，仅供参考） |
| `code` | `string \| undefined` | 源码内容 |
| `ast` | `BabelStyleAST \| undefined` | Babel AST |
| `dependencies` | `Set<ModuleNode>` | 当前模块依赖的模块 |
| `importers` | `Set<ModuleNode>` | 依赖当前模块的模块 |
| `importedBindings` | `Map<string, { id, specifiers, importee }>` | 导入的变量详情 |
| `error` | `{ type, message } \| undefined` | 解析错误 |
| `toJSON()` | `() => object` | 安全序列化（循环引用标记为 `_circular: true`） |
