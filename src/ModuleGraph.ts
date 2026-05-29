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
  /** 源码内容 */
  code!: string;
  /** AST 语法树 */
  ast!: BabelStyleAST;
  /** 当前模块依赖的 */
  dependencies = new Set<ModuleNode>();
  /** 哪些模块依赖当前模块 */
  importers = new Set<ModuleNode>();
  /** 导入的具体变量 */
  importedBindings = new Map<string, Set<string>>();

  constructor(id: string) {
    this.id = id;
    // this.ast = babelParse(code, { sourceType: 'module' }).program;
  }

  /** JSON 序列化：Set/Map 降级为 Array/Object，避免循环引用 */
  toJSON() {
    return {
      id: this.id,
      dependencies: [...this.dependencies].map((d) => d.id),
      importers: [...this.importers].map((d) => d.id),
      importedBindings: Object.fromEntries(
        [...this.importedBindings].map(([k, v]) => [k, [...v]]),
      ),
    };
  }
}

export class ModuleGraph {
  public modules = new Map<string, ModuleNode>();
  /** 路由维度文件入口(多个) */
  public entryPoints: Set<ModuleNode> = new Set();

  /** 路径解析别名 */
  private alias;

  constructor(private options: ModuleGraphOptions = {}) {
    this.alias = this.options.alias ?? {};
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
  public async addModule(id: string, isEntry = false): Promise<ModuleNode> {
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
    await this.resolveDependencies(module);

    return module;
  }

  private async resolveDependencies(module: ModuleNode): Promise<void> {
    const ast = this.parseAST(module.code);
    const imports = this.extractImports(ast);

    for (const importInfo of imports) {
      // 路径解析（需要处理 alias、node_modules 等）
      const resolvedPath = await this.resolvePath(importInfo.source, module.id);

      // 无法解析的路径跳过（如绝对路径等）
      if (!resolvedPath) continue;

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

      // 建立双向连接
      module.dependencies.add(depModule);
      depModule.importers.add(module);

      // 记录具体的导入绑定
      module.importedBindings.set(resolvedPath, new Set(importInfo.specifiers));
    }
  }

  private parseAST(code: string) {
    return babelParse(code, { sourceType: 'module' });
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

  private async resolvePath(source: string, importer: string): Promise<string | null> {
    // 1. 相对路径
    if (source.startsWith('.')) {
      return path.resolve(path.dirname(importer), source);
    }

    // 2. alias
    for (const [key, getPath] of Object.entries(this.alias)) {
      const prefix = `${key}/`;
      if (source.startsWith(prefix)) {
        return getPath() + source.slice(prefix.length - 1);
      }
    }

    // 3. node_modules — 只记录包名，不深入解析
    if (!source.startsWith('.') && !source.startsWith('/')) {
      return `node_modules/${source}`;
    }

    // 4. 其它情况
    return null;
  }
}
