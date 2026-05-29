import fs from 'fs';
import path from 'path';
import { parse as babelParse } from '@babel/parser';
import type {
  BabelStyleAST,
  ModuleGraphOptions,
} from './types';

/** 核心数据结构 */
class ModuleNode {
  /** 模块的唯一标识，通常是文件的绝对路径 */
  id: string;
  /**
   * - 原始 id
   * - rawId 自身只能作为一种参考, 本质上是不准确的; 比如说 ./foo.ts, ../foo.ts 都指向同一个文件就不准了
   */
  rawId: string;
  /** 源码内容 */
  code: string | undefined;
  /** AST 语法树 */
  ast: BabelStyleAST | undefined;
  /** 当前模块依赖的 */
  dependencies = new Set<ModuleNode>();
  /** 哪些模块依赖当前模块 */
  importers = new Set<ModuleNode>();
  /** 导入的具体变量 */
  importedBindings = new Map<string, {
    id: string;
    rawId: string;
    specifiers: Set<string>;
  }>();
  /** 解析错误 */
  error?: {
    type: 'parse' | 'resolve' | 'unknown';
    message: string;
    extra?: any;
  };

  constructor({ id, rawId }: {
    id: string;
    rawId: string;
  }) {
    this.id = id;
    this.rawId = rawId;
  }

  /** JSON 序列化：Set/Map 降级为 Array/Object，避免循环引用 */
  toJSON() {
    return this._serialize(new Set());
  }

  /** 递归序列化，visited 防止循环引用 */
  private _serialize(visited: Set<ModuleNode>): any {
    if (visited.has(this)) {
      return { _circular: true } as any;
    }
    visited.add(this);

    return {
      dependencies: Object.fromEntries(
        [...this.dependencies].map((d) => [d.id, d._serialize(visited)]),
      ),
      /*
      importers: Object.fromEntries([...this.importers].map((d) => [d.rawId, d._serialize(visited)])),
      importedBindings: Object.fromEntries(
        [...this.importedBindings].map(([k, v]) =>
          [k,
            {
              id: v.id,
              specifiers: [...v.specifiers],
            },
          ]),
      ),
      */
      error: this.error
        ? {
          type: this.error.type,
          message: this.error.message,
        }
        : undefined,
    };
  }
}

export class ModuleGraph {
  public modules = new Map<string, ModuleNode>();
  /** 路由维度文件入口(多个) */
  public entryPoints: Set<ModuleNode> = new Set();

  /** 路径解析别名 */
  private alias;
  /** 文件扩展名 */
  private extensions;

  constructor(private options: ModuleGraphOptions = {}) {
    this.alias = this.options.alias ?? {};
    this.extensions = this.options.extensions ?? ['.js', '.jsx', '.ts', '.tsx', '.json'];
  }

  /** JSON 序列化：Map/Set 降级为 Object/Array，方便调试输出 */
  public toJSON() {
    return {
      entryPoints: [...this.entryPoints].map((m) => m.id),
      modules: Object.fromEntries(
        [...this.modules].map(([id, mod]) => [id, mod.toJSON()]),
      ),
    };
  }

  /** 添加模块(核心方法) */
  public async addModule({
    id,
    rawId,
    isEntry = false,
  }: {
    id: string;
    rawId: string;
    isEntry?: boolean;
  }): Promise<ModuleNode | null> {
    if (this.modules.has(id)) {
      return this.modules.get(id)!;
    }

    const module = new ModuleNode({ id, rawId });
    this.modules.set(id, module);

    if (isEntry) {
      this.entryPoints.add(module);
    }

    // 读取源码
    module.code = await fs.promises.readFile(id, 'utf-8');

    // 解析 AST 并读取依赖
    // TODO: .less, .png 等非 js 模块的依赖处理
    await this.resolveDependencies(module);

    return module;
  }

  private async resolveDependencies(module: ModuleNode): Promise<void> {
    let ast: BabelStyleAST | undefined;

    try {
      ast = this.parseAST(module.code as string);
    } catch (error: any) {
      module.error = {
        type: 'parse',
        message: error.message,
        extra: error,
      };
    }
    if (!ast) return;

    const imports = this.extractImports(ast);

    for (const importInfo of imports) {
      const rawId = importInfo.source;
      // 路径解析（需要处理 alias、node_modules 等）
      const resolvedId = await this.resolveId(importInfo.source, module.id);

      // 无法解析的路径跳过（如绝对路径等）
      if (!resolvedId) continue;

      // node_modules 作为叶子节点，只记录依赖关系，不深入解析
      let depModule: ModuleNode;
      if (resolvedId.startsWith('node_modules/')) {
        if (this.modules.has(resolvedId)) {
          depModule = this.modules.get(resolvedId)!;
        } else {
          depModule = new ModuleNode({ id: resolvedId, rawId });
          this.modules.set(resolvedId, depModule);
        }
      } else {
        const depMod = await this.addModule({ id: resolvedId, rawId });
        if (!depMod) continue;
        depModule = depMod;
      }

      // 建立双向连接
      module.dependencies.add(depModule);
      depModule.importers.add(module);

      // 记录具体的导入绑定
      module.importedBindings.set(rawId, {
        id: resolvedId,
        rawId,
        specifiers: new Set(importInfo.specifiers),
      });
    }
  }

  private parseAST(code: string): BabelStyleAST {
    return babelParse(code, {
      sourceType: 'module',
      plugins: [
        'jsx',
        'typescript',
      ],
    });
  }

  private extractImports(
    ast: BabelStyleAST,
  ): Array<{ source: string; specifiers: string[] }> {
    const imports: Array<{ source: string; specifiers: string[] }> = [];

    for (const node of ast.program.body) {
      // 仅处理静态 import 声明
      if (node.type !== 'ImportDeclaration') continue;

      const source = node.source.value;
      const specifiers = node.specifiers.map((spec) => {
        switch (spec.type) {
          // e.g. import foo from 'foo'
          case 'ImportDefaultSpecifier':
            return 'default';
          // e.g. import * as foo from 'foo'
          case 'ImportNamespaceSpecifier':
            return '*';
          case 'ImportSpecifier': {
            // e.g. import { foo } / import { foo as bar }
            const imported = spec.imported;
            // ES2022 允许 string literal 导入名(如 import { "foo" as bar })
            // 业务代码中几乎不会出现，此处兜底处理
            return imported.type === 'Identifier'
              ? imported.name
              : imported.value;
          }
          default:
            return '';
        }
      }).filter(Boolean);

      imports.push({ source, specifiers });
    }

    return imports;
  }

  /** alias 前缀匹配解析（独立方法，供 addModule 和 resolvePath 复用） */
  private async resolveAlias(source: string): Promise<string | null> {
    for (const [key, getPath] of Object.entries(this.alias)) {
      const prefix = `${key}/`;
      if (source.startsWith(prefix)) {
        return getPath() + source.slice(prefix.length - 1);
      }
    }

    return null;
  }

  private async tryResolveWithExt(source: string): Promise<string | null> {
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      return source;
    }

    for (const ext of this.extensions) {
      const filePaths = [
        // e.g. import './foo' -> './foo.ts'
        source + ext,
        // e.g. import './foo' -> './foo/index.ts'
        `${source}/index${ext}`,
      ];

      for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }

    return null;
  }

  private async resolveId(source: string, importer?: string): Promise<string | null> {
    // 1. 绝对路径
    if (path.isAbsolute(source)) {
      return await this.tryResolveWithExt(source);
    }

    // 2. 相对路径
    if (source.startsWith('.') && importer) {
      const id = path.resolve(path.dirname(importer), source);
      return await this.tryResolveWithExt(id);
    }

    // 3. alias
    const aliasResolved = await this.resolveAlias(source);
    if (aliasResolved) {
      return await this.tryResolveWithExt(aliasResolved);
    }

    // 4. node_modules — 只记录包名，不深入解析(裸模块)
    if (!source.startsWith('.') && !source.startsWith('/')) {
      return `node_modules/${source}`;
    }

    // 5. 其它情况 - 不做处理(.less, .png)
    return null;
  }
}
