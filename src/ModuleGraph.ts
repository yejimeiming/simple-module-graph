import fs from 'fs';
import path from 'path';
import { parse as babelParse } from '@babel/parser';
import type {
  BabelStyleAST,
  ImportInfo,
  ModuleGraphOptions,
} from './types';

/** 核心数据结构 */
class ModuleNode {
  /** 模块的唯一标识，通常是文件的绝对路径 */
  id: string;
  /**
   * - 原始 id
   * @deprecated rawId 自身只能作为一种参考, 本质上是不准确的; 比如说 ./foo.ts, ../foo.ts 都指向同一个文件就不准了
   */
  rawId: string | undefined;
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
    specifiers: Set<string>;
    /** 模块的导入字符串 */
    importee: string;
  }>();
  /** 解析错误 */
  error?: {
    type: 'parse' | 'resolve' | 'unknown';
    message: string;
    extra?: any;
  };

  constructor(id: string) {
    this.id = id;
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
  /** Map<模块id, 模块节点> */
  public modules = new Map<string, ModuleNode>();
  /** 路由维度文件入口(多个) */
  public entryPoints: Set<ModuleNode> = new Set();

  /** 项目根目录 */
  private cwd: string;
  /** 路径解析别名 */
  private alias;
  /** 文件扩展名 */
  private extensions;

  constructor(private options: ModuleGraphOptions = {}) {
    this.cwd = this.options.cwd ?? process.cwd();
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
  public async addModule(id: string, isEntry?: boolean): Promise<ModuleNode | null> {
    if (this.modules.has(id)) {
      return this.modules.get(id)!;
    }

    const module = new ModuleNode(id);
    this.modules.set(id, module);

    if (isEntry) {
      this.entryPoints.add(module);
    }

    // 读取源码
    module.code = await fs.promises.readFile(id, 'utf-8');

    // 解析 AST 并读取依赖
    // TODO: .less, .png 等非 js 模块的依赖处理
    try {
      module.ast = this.parseAST(module.code);
    } catch (error: any) {
      module.error = {
        type: 'parse',
        message: error.message,
        extra: error,
      };
    }

    await this.resolveDependencies(module);

    return module;
  }

  public async resolveDependencies(module: ModuleNode): Promise<void> {
    const code = module.code;
    const ast = module.ast;

    if (!code || !ast) return;

    const imports = this.extractImports(ast, code);

    for (const importInfo of imports) {
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
          depModule = new ModuleNode(resolvedId);
          this.modules.set(resolvedId, depModule);
        }
      } else {
        const depMod = await this.addModule(resolvedId);
        if (!depMod) continue;
        depModule = depMod;
      }

      // 建立双向连接
      module.dependencies.add(depModule);
      depModule.importers.add(module);

      // 记录具体的导入绑定
      module.importedBindings.set(resolvedId, {
        id: resolvedId,
        specifiers: new Set(importInfo.specifiers),
        importee: importInfo.importee,
      });
    }
  }

  public parseAST(code: string): BabelStyleAST {
    return babelParse(code, {
      sourceType: 'module',
      plugins: [
        'jsx',
        'typescript',
      ],
    });
  }

  public extractImports(ast: BabelStyleAST, code: string): Array<ImportInfo> {
    const imports: Array<ImportInfo> = [];

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

      imports.push({
        source,
        specifiers,
        importee: code.slice(node.start!, node.end!),
      });
    }

    return imports;
  }

  /** alias 前缀匹配解析（独立方法，供 addModule 和 resolvePath 复用） */
  public async resolveAlias(source: string): Promise<string | null> {
    for (const [key, getPath] of Object.entries(this.alias)) {
      const prefix = `${key}/`;
      if (source.startsWith(prefix)) {
        return getPath() + source.slice(prefix.length - 1);
      }
    }

    return null;
  }

  public async tryResolveWithExt(source: string): Promise<string | null> {
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

  public async resolveEntryFile(source: string): Promise<string | null> {
    return await this.tryResolveWithExt(
      path.resolve(this.cwd, source),
    );
  }

  public async resolveId(source: string, importer?: string): Promise<string | null> {
    // 1. 绝对路径
    if (path.isAbsolute(source)) {
      return await this.tryResolveWithExt(source);
    }

    // 2. 相对路径
    if (source.startsWith('.')) {
      if (importer) {
        return await this.tryResolveWithExt(
          path.resolve(path.dirname(importer), source),
        );
      }
      // 2.1. 相对路径 - 无 importer(entry file)
      return await this.resolveEntryFile(source);
    }

    // 3. alias
    const aliasResolved = await this.resolveAlias(source);
    if (aliasResolved) {
      return await this.tryResolveWithExt(aliasResolved);
    }

    // 4. node_modules — 只记录包名，不深入解析(裸模块)
    if (!source.startsWith('.') && !source.startsWith('/')) {
      if (importer) {
        return `node_modules/${source}`;
      }
      // 4.1. 裸模块 - 无 importer(entry file)
      return await this.resolveEntryFile(source);
    }

    // 5. 其它情况 - 不做处理(.less, .png)
    return null;
  }
}
