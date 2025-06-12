#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-parameter-properties */
/* eslint-disable no-nested-ternary */
/* eslint-disable curly */
/* eslint-disable max-depth */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as ts from 'typescript';

interface ImportInfo {
  file: string;
  imports: string[];
  type: 'import' | 'export';
  packageName: string;
}

class ImportExtractor {
  private results: ImportInfo[] = [];

  constructor(
    private searchPath: string,
    private targetPkg: string | RegExp,
    private excludePaths: string[] = [],
  ) {
  }

  /**
   * Check if a package name matches the mojito-utils pattern
   */
  private isTargetPkg(packageName: string): boolean {
    const cleanName = packageName.replace(/^['"]|['"]$/g, '');
    return typeof this.targetPkg === 'string' ? cleanName.startsWith(this.targetPkg) : this.targetPkg.test(cleanName);
  }

  /**
   * Extract import/export names from a node
   */
  private extractImportNames(node: ts.Node): string[] {
    const names: string[] = [];

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const importClause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;

      if (importClause) {
        // Default import: import foo from '...'
        if (ts.isImportDeclaration(node) && importClause.name) {
          names.push(importClause.name.text);
        }

        // Named imports: import { a, b } from '...' or export { a, b } from '...'
        if (importClause.namedBindings) {
          if (ts.isNamedImports(importClause.namedBindings) || ts.isNamedExports(importClause.namedBindings)) {
            importClause.namedBindings.elements.forEach(element => {
              if (ts.isImportSpecifier(element) || ts.isExportSpecifier(element)) {
                const name = element.name?.text || element.propertyName?.text;
                if (name) names.push(name);
              }
            });
          }
          // Namespace import: import * as foo from '...'
          else if (ts.isNamespaceImport(importClause.namedBindings)) {
            names.push(importClause.namedBindings.name.text);
          }
        }
      }
    }

    return names;
  }

  /**
   * Get package name from import/export statement
   */
  private getPackageName(node: ts.ImportDeclaration | ts.ExportDeclaration): string | null {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      return node.moduleSpecifier.text;
    }
    return null;
  }

  /**
   * Process a single TypeScript file
   */
  private processFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true
      );

      const visit = (node: ts.Node) => {
        // Handle import declarations
        if (ts.isImportDeclaration(node)) {
          const packageName = this.getPackageName(node);
          if (packageName && this.isTargetPkg(packageName)) {
            const imports = this.extractImportNames(node);
            if (imports.length > 0) {
              this.results.push({
                file: path.relative(this.searchPath, filePath),
                imports,
                type: 'import',
                packageName
              });
            }
          }
        }

        // Handle export declarations
        else if (ts.isExportDeclaration(node)) {
          const packageName = this.getPackageName(node);
          if (packageName && this.isTargetPkg(packageName)) {
            const imports = this.extractImportNames(node);
            if (imports.length > 0) {
              this.results.push({
                file: filePath,
                imports,
                type: 'export',
                packageName
              });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    }
  }

  /**
   * Scan directory for TypeScript files and extract imports
   */
  async scanDirectory(patterns: string[] = ['**/*.ts', '**/*.tsx']): Promise<string[]> {
    this.results = [];

    try {
      const allFiles = new Set<string>();

      for (const pattern of patterns) {
        const files = await glob(pattern, {
          cwd: this.searchPath,
          ignore: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', ...(this.excludePaths ? this.excludePaths : [])]
        });
        files.forEach(file => allFiles.add(file));
      }

      // console.error(`Processing ${allFiles.size} files...`);

      for (const file of allFiles) {
        this.processFile(path.resolve(this.searchPath, file));
      }

      // Extract all unique import names
      const allImports = new Set<string>();
      this.results.forEach(result => {
        result.imports.forEach(imp => {
          // Handle destructured imports like "{ sleep, throttle }"
          const cleaned = imp.replace(/[{}]/g, '').trim();
          if (cleaned.includes(',')) {
            cleaned.split(',').forEach(name => {
              const trimmed = name.trim();
              if (trimmed) allImports.add(trimmed);
            });
          } else if (cleaned) {
            allImports.add(cleaned);
          }
        });
      });

      return Array.from(allImports).sort();
    } catch (error) {
      console.error('Error scanning directory:', error);
      return [];
    }
  }

  /**
   * Get detailed results with file information
   */
  getDetailedResults(): ImportInfo[] {
    return this.results;
  }

  /**
   * Print results in different formats
   */
  printResults(format: 'simple' | 'detailed' | 'json' = 'simple'): void {
    if (format === 'json') {
      console.log(JSON.stringify(this.results, null, 2));
    } else if (format === 'detailed') {
      this.results.sort((a, b) => a.file.localeCompare(b.file)).forEach(result => {
        console.log(`${result.file}: ${result.imports.join(', ')} (${result.type} from ${result.packageName})`);
      });
    } else {
      // Simple format - just unique import names
      const allImports = new Set<string>();
      this.results.forEach(result => {
        result.imports.forEach(imp => {
          const cleaned = imp.replace(/[{}]/g, '').trim();
          if (cleaned.includes(',')) {
            cleaned.split(',').forEach(name => {
              const trimmed = name.trim();
              if (trimmed) allImports.add(trimmed);
            });
          } else if (cleaned) {
            allImports.add(cleaned);
          }
        });
      });

      Array.from(allImports).sort().forEach(imp => console.log(imp));
    }
  }
}

function getArg(args: string[], name: string) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? (arg.split('=')[1]) : '';
}

function usage() {
  console.log(`
    Usage: search-imports --searchPath=<path> --targetPkg=<pkg> --excludePaths=<paths>
    Example: search-imports --searchPath=./packages --targetPkg=@scope/pkg-name --excludePaths=./packages/pkg
  `);
}

// CLI usage
async function main() {
  const args = process.argv.slice(2);
  const searchPath = getArg(args, 'searchPath') ?? '.';
  const targetPkg = getArg(args, 'targetPkg');
  const excludePaths = getArg(args, 'excludePaths') ?? '';
  const showHelp = args.includes('--help');

  if (showHelp) {
    usage();
    process.exit(0);
  }

  if (!searchPath) {
    console.error('--searchPath is required');
    usage();
    process.exit(1);
  }
  if (!targetPkg) {
    console.error('--targetPkg is required');
    usage();
    process.exit(1);
  }

  const format = args.includes('--json') ? 'json' :
                args.includes('--detailed') ? 'detailed' : 'simple';

  const patterns = args.filter(arg => !arg.startsWith('--'));
  const searchPatterns = patterns.length > 0 ? patterns : ['**/*.ts', '**/*.tsx'];

  const extractor = new ImportExtractor(searchPath, targetPkg, excludePaths ? excludePaths.split(',') : []);
  await extractor.scanDirectory(searchPatterns);
  extractor.printResults(format);
}

// Export for use as a module
export { ImportExtractor  };


// Run as CLI if this file is executed directly
if (require.main === module || process.argv[1]?.endsWith('search-imports')) {
  main().catch(console.error);
}