import { parse as babelParse } from '@babel/parser';

/**
 * - ESTree 标准（如 Acorn、Espree 等）：Program 是顶层节点
 * - Babel Parser：File 是顶层节点
 */
export type BabelStyleAST = ReturnType<typeof babelParse>;

export interface ModuleGraphOptions {
  /** 项目根目录，默认 process.cwd() */
  cwd?: string;
  /** 路径解析别名 */
  alias?: Record<string, () => string>;
  /** 文件扩展名 */
  extensions?: string[];
}

export interface GetModuleGraphOptions {
  /** 入口文件路径，支持相对路径或绝对路径 */
  files: string | string[];
  /** 项目根目录，默认 process.cwd() */
  cwd?: string;
  /** 自定义别名，会覆盖内置别名 */
  alias?: Record<string, () => string>;
}

/**
 * e.g.
 * ```js
 * import React, { useEffect } from 'react';
 * ```
 * 
 * @example
 * ```
 * source: 'react',
 * specifiers: [ 'default', 'useEffect' ],
 * importee: "import React, { useEffect } from 'react';"
 * ```
 */
export interface ImportInfo {
  source: string;
  specifiers: string[];
  /** 模块的导入字符串(短 id) */
  importee: string;
}
