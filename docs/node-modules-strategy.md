# Module Graph 中 node_modules 的处理策略

## 问题背景

在 `ModuleGraph.resolvePath` 中，原始实现对 node_modules 包使用了 `require.resolve`：

```ts
// 原始实现
if (!source.startsWith('.') && !source.startsWith('/')) {
  return require.resolve(source);
}
```

这种方式存在三个问题：

### 1. 递归解析整个 node_modules

`require.resolve` 返回包的入口文件绝对路径，`resolveDependencies` 会继续 `addModule` 读取并解析其依赖，导致递归解析整个 node_modules 依赖树：

```
用户代码 → lodash → lodash 的依赖 → 依赖的依赖 → ...
```

用户不控制 node_modules 的代码，解析它们既慢又容易出错（第三方包可能使用特殊语法、需要特定 babel 配置）。

### 2. `require.resolve` 会抛异常

包不存在、缺少 `main`/`exports` 字段、原生模块等情况都会 throw，在实际使用中会中断整个图构建。

### 3. 丢失包名语义信息

`require.resolve('lodash')` 返回类似 `node_modules/lodash/lodash.js` 的路径，丢失了用户写的 `import { map } from 'lodash'` 中的 `lodash` 语义信息。

## 解决方案：叶子节点策略

对 module graph 工具来说，node_modules 包应作为**叶子节点**——只记录依赖关系，不深入解析内部。

### resolvePath 修改

```ts
// 修改后：只记录包名，不深入解析
if (!source.startsWith('.') && !source.startsWith('/')) {
  return `node_modules/${source}`;
}
```

效果：
- `lodash` → `node_modules/lodash`
- `@babel/parser` → `node_modules/@babel/parser`
- 不再调用 `require.resolve`，不会抛异常
- 保留了包名信息

### resolveDependencies 修改

```ts
// node_modules 作为叶子节点，只记录依赖关系，不深入解析
let depModule: ModuleNode;
if (resolvedPath.startsWith('node_modules/')) {
  if (this.modules.has(resolvedPath)) {
    depModule = this.modules.get(resolvedPath)!;
  } else {
    depModule = new ModuleNode(resolvedPath);
    this.modules.set(resolvedPath, depModule);
  }
} else {
  depModule = await this.addModule(resolvedPath);
}
```

叶子节点的特征：
- 不读取文件内容（`code` 为 `undefined`）
- 不解析 AST 和依赖（`dependencies` 为空）
- 仍参与双向连接（`importers` 正常记录）
- 仍记录导入绑定（`importedBindings` 正常记录）

## 与 Rollup 的对比

| | Rollup | Module Graph |
|---|---|---|
| **默认行为** | 不解析 node_modules（标记为 external） | 标记为叶子节点 |
| **深入解析** | 需要 `@rollup/plugin-node-resolve` | 不深入（只关心用户代码） |
| **CJS 支持** | 需要 `@rollup/plugin-commonjs` 转换 | 不处理 |
| **递归策略** | 配合插件会递归整个依赖树 | 不递归 |
| **设计目标** | 打包 + tree-shaking | 依赖关系分析 |

### Rollup 的完整流程

```
源码 import { map } from 'lodash'
  │
  ├─ 无 plugin-node-resolve → 标记为 external，保留原样
  │
  └─ 有 plugin-node-resolve
       │
       ├─ resolve 到 node_modules/lodash/lodash.js
       │
       ├─ 读取文件，发现是 CJS
       │   ├─ 无 plugin-commonjs → 报错
       │   └─ 有 plugin-commonjs → CJS → ESM 转换
       │       │
       │       ├─ 深入解析 lodash 内部依赖
       │       └─ tree-shaking 剔除未使用的导出
       │
       └─ 递归解析 lodash 的依赖
```

## 总结

对于 module graph 场景，叶子节点策略是合理的——关心的是"哪些模块依赖了 lodash"，而不是 lodash 内部长什么样。如果未来需要 tree-shaking 分析，可以参考 Rollup 的插件机制扩展深入解析能力。
