# Alias 与路径解析设计

## 概述

`ModuleGraph` 使用 prefix-based alias 作为路径解析的扩展点，`getModuleGraph` 在此基础上封装内置别名，简化调用方使用。

## API 分层

| 层 | 职责 | 扩展点 |
|---|---|---|
| `ModuleGraph` | 底层，前缀匹配 alias | `alias: Record<string, () => string>` |
| `getModuleGraph` | 便捷层，内置 alias + cwd | `files` / `cwd` / `alias` 覆盖 |

### ModuleGraph 层

```ts
const graph = new ModuleGraph({
  alias: {
    '@': () => '/project/src',
  },
});
await graph.addModule('/project/src/index.ts', true);
```

### getModuleGraph 层

```ts
const graph = await getModuleGraph({
  files: 'src/index.ts',
  cwd: '/project',
});
```

## 内置别名约定

| 别名 | 指向 | 来源 |
|---|---|---|
| `@` | `<cwd>/src` | Vue CLI / Vite / umi 等主流约定 |
| `~` | `<cwd>/node_modules` | webpack css-loader / sass-loader 约定 |

`~` 指向 `node_modules` 而非 `src`，原因：
- JS 中裸标识符（`lodash`）已自动解析到 node_modules，无需 `~` 前缀
- `~` → `node_modules` 是 webpack 生态（css-loader / sass-loader）的既定约定，如 `@import '~antd/dist/antd.css'`
- 避免与 `@` 语义重复（两者都指向 `src` 没有区分度）

调用方可以通过 `alias` 参数覆盖内置别名：

```ts
await getModuleGraph({
  files: 'src/index.ts',
  cwd: '/project',
  alias: {
    '~': () => '/project/src',  // 覆盖内置的 ~ → node_modules
  },
});
```

## 为什么不用 `resolveId` 钩子

Rollup 的路径解析通过 `resolveId` 钩子暴露，alias 由 `@rollup/plugin-alias` 插件实现：

```
Rollup Core
  └── resolveId hook (扩展点)
        └── @rollup/plugin-alias (插件)
```

我们讨论过是否引入 `resolveId` 替代 alias，结论是**当前不需要**：

1. **没有插件系统** — Rollup 需要 `resolveId` 是因为它有插件生态，alias 由插件提供是合理的分工；没有插件系统时，内置 alias 是务实的选择
2. **alias 已覆盖主要场景** — `@` → src、`~` → node_modules、monorepo 路径映射，prefix-based alias 足够
3. **`*` 通配符是概念混淆** — `*` 本质是 resolve hook 而非 alias，放入 `Record<string, () => string>` 语义不对
4. **YAGNI** — 没有具体场景需要 virtual modules、条件解析等 `resolveId` 能力

### 演进路径

如果将来出现 alias 无法满足的场景（如插件系统、virtual modules），可以：

1. `ModuleGraph` 引入 `resolveId` 钩子
2. alias 降级为基于 `resolveId` 的默认实现
3. `getModuleGraph` 将 alias 编译成 `resolveId` 函数
4. 向后兼容

这与 Rollup 的演进路径一致——Rolldown（Rust 重写的 Rollup）把 `resolve.alias` 做成内置配置，但也因此引发了内置 alias 跳过 `resolveId` 钩子链的问题，说明内置 alias 和插件系统共存时需要谨慎设计。

## resolvePath 解析优先级

```
1. 相对路径（./ ../）  → path.resolve 基于 importer 目录
2. alias 前缀匹配     → alias[key]() + 剩余路径
3. 裸标识符            → node_modules/${source}（叶子节点）
4. 其他               → null（跳过）
```

注意 alias 前缀匹配是 `source.startsWith(key + '/')`，例如 `@/utils` 匹配 `@`，但 `@babel/parser` 不匹配（因为是 `@b` 而非 `@/`），所以内置 `@` alias 不会干扰 scoped package 的解析。
