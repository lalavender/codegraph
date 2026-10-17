import { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './tree-sitter-helpers';

const YH_KEYWORDS = new Set([
  'module', 'pub', 'let', 'const', 'fn', 'type', 'struct', 'union', 'enum',
  'if', 'else', 'for', 'in', 'switch', 'case', 'default', 'break', 'continue',
  'goto', 'return', 'true', 'false', 'nil', 'extern', 'inline',
]);

export class YhExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    try {
      const fileNode = this.createFileNode();
      this.parseModule();
      this.parseImports(fileNode);
      this.parseStructs(fileNode);
      this.parseEnums(fileNode);
      this.parseTypeAliases(fileNode);
      this.parseConsts(fileNode);
      this.parseLets(fileNode);
      this.parseFunctions(fileNode);
    } catch (error) {
      this.errors.push({
        message: `YH extraction error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        code: 'parse_error',
      });
    }
    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private createFileNode(): Node {
    const lines = this.source.split('\n');
    const id = generateNodeId(this.filePath, 'file', this.filePath, 1);
    const fileNode: Node = {
      id,
      kind: 'file',
      name: this.filePath.split('/').pop() || this.filePath,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'yh' as any,
      startLine: 1,
      endLine: lines.length,
      startColumn: 0,
      endColumn: lines[lines.length - 1]?.length || 0,
      updatedAt: Date.now(),
    };
    this.nodes.push(fileNode);
    return fileNode;
  }

  private lineOfIndex(idx: number): number {
    return this.source.slice(0, idx).split('\n').length;
  }

  private parseModule(): void {
    const m = this.source.match(/^\s*module\s+(\w+)\s*;/m);
    // no node kind for module in NodeKind? 'module' exists
    if (m && m[1]!) {
      const idx = this.source.indexOf(m[0]);
      const line = this.lineOfIndex(idx);
      const id = generateNodeId(this.filePath, 'module', m[1]!, line);
      this.nodes.push({
        id,
        kind: 'module',
        name: m[1]!,
        qualifiedName: `${this.filePath}#${m[1]!}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: m[0]!.length,
        updatedAt: Date.now(),
      });
    }
  }

  private parseImports(fileNode: Node): void {
    const re = /\bimport\s+([\w.]+)(?:\s+as\s+(\w+))?\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[2]! || m[1]!.split('.').pop() || m[1]!;
      const line = this.lineOfIndex(m.index);
      const id = generateNodeId(this.filePath, 'import', name, line);
      this.nodes.push({
        id,
        kind: 'import',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: m[0]!.length,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
      this.unresolvedReferences.push({
        fromNodeId: fileNode.id,
        referenceName: m[1]!,
        referenceKind: 'imports',
        line,
        column: 0,
        filePath: this.filePath,
      });
    }
  }

  private parseStructs(fileNode: Node): void {
    const re = /\b(pub\s+)?(struct|union)\s+(\w+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const kindWord = m[2]!;
      const name = m[3]!;
      const kind = kindWord === 'union' ? 'union' : 'struct';
      const nodeKind = kind === 'union' ? 'union' : 'struct';
      const line = this.lineOfIndex(m.index);
      const openIdx = this.source.indexOf('{', m.index);
      const closeIdx = this.findMatchingBrace(openIdx);
      const endLine = closeIdx >= 0 ? this.lineOfIndex(closeIdx) : line;
      const id = generateNodeId(this.filePath, nodeKind as any, name, line);
      this.nodes.push({
        id,
        kind: nodeKind as any,
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
      // fields
      if (closeIdx >= 0) {
        const body = this.source.slice(openIdx + 1, closeIdx);
        const fieldRe = /(\w+)\s+([\w\[\]*]+(?:\s*\*\s*\w+)?)\s*;/g;
        let fm: RegExpExecArray | null;
        while ((fm = fieldRe.exec(body)) !== null) {
          const fieldName = fm[1]!;
          if (YH_KEYWORDS.has(fieldName)) continue;
          const fLine = this.lineOfIndex(openIdx + 1 + fm.index);
          const fid = generateNodeId(this.filePath, 'field', `${name}.${fieldName}`, fLine);
          this.nodes.push({
            id: fid,
            kind: 'field',
            name: fieldName,
            qualifiedName: `${this.filePath}#${name}.${fieldName}`,
            filePath: this.filePath,
            language: 'yh' as any,
            startLine: fLine,
            endLine: fLine,
            startColumn: 0,
            endColumn: 0,
            updatedAt: Date.now(),
          });
          this.edges.push({ source: id, target: fid, kind: 'contains' });
        }
      }
    }
  }

  private parseEnums(fileNode: Node): void {
    const re = /\b(pub\s+)?enum\s+(\w+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[2]!;
      const line = this.lineOfIndex(m.index);
      const openIdx = this.source.indexOf('{', m.index);
      const closeIdx = this.findMatchingBrace(openIdx);
      const endLine = closeIdx >= 0 ? this.lineOfIndex(closeIdx) : line;
      const id = generateNodeId(this.filePath, 'enum', name, line);
      this.nodes.push({
        id,
        kind: 'enum',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
      if (closeIdx >= 0) {
        const body = this.source.slice(openIdx + 1, closeIdx);
        const itemRe = /(\w+)\s*(?:=\s*[^;]+)?\s*;/g;
        let im: RegExpExecArray | null;
        while ((im = itemRe.exec(body)) !== null) {
          const itemName = im[1]!;
          if (YH_KEYWORDS.has(itemName)) continue;
          const iLine = this.lineOfIndex(openIdx + 1 + im.index);
          const iid = generateNodeId(this.filePath, 'enum_member', `${name}.${itemName}`, iLine);
          this.nodes.push({
            id: iid,
            kind: 'enum_member',
            name: itemName,
            qualifiedName: `${this.filePath}#${name}.${itemName}`,
            filePath: this.filePath,
            language: 'yh' as any,
            startLine: iLine,
            endLine: iLine,
            startColumn: 0,
            endColumn: 0,
            updatedAt: Date.now(),
          });
          this.edges.push({ source: id, target: iid, kind: 'contains' });
        }
      }
    }
  }

  private parseTypeAliases(fileNode: Node): void {
    const re = /\b(?:pub\s+)?type\s+(\w+)\s*=/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[1]!;
      const line = this.lineOfIndex(m.index);
      const id = generateNodeId(this.filePath, 'type_alias', name, line);
      this.nodes.push({
        id,
        kind: 'type_alias',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
    }
  }

  private parseConsts(fileNode: Node): void {
    const re = /\b(?:pub\s+)?const\s+(\w+)\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[1]!;
      const line = this.lineOfIndex(m.index);
      const id = generateNodeId(this.filePath, 'constant', name, line);
      this.nodes.push({
        id,
        kind: 'constant',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
    }
  }

  private parseLets(fileNode: Node): void {
    const re = /\b(?:pub\s+)?let\s+(\w+)\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[1]!;
      const line = this.lineOfIndex(m.index);
      const id = generateNodeId(this.filePath, 'variable', name, line);
      this.nodes.push({
        id,
        kind: 'variable',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });
    }
  }

  private parseFunctions(fileNode: Node): void {
    const re = /\bfn\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.source)) !== null) {
      if (this.depthAt(m.index) !== 0) continue;
      const name = m[1]!;
      const line = this.lineOfIndex(m.index);
      // find param close paren
      const openParen = this.source.indexOf('(', m.index);
      const closeParen = this.findMatchingParen(openParen);
      if (closeParen < 0) continue;
      // find body
      let i = closeParen + 1;
      // skip return type (until { or ;)
      while (i < this.source.length && this.source[i] !== '{' && this.source[i] !== ';') i++;
      let bodyStart = -1;
      let bodyEnd = -1;
      if (this.source[i] === '{') {
        bodyStart = i;
        bodyEnd = this.findMatchingBrace(i);
      }
      const endLine = bodyEnd >= 0 ? this.lineOfIndex(bodyEnd) : line;
      const id = generateNodeId(this.filePath, 'function', name, line);
      this.nodes.push({
        id,
        kind: 'function',
        name,
        qualifiedName: `${this.filePath}#${name}`,
        filePath: this.filePath,
        language: 'yh' as any,
        startLine: line,
        endLine,
        startColumn: 0,
        endColumn: 0,
        updatedAt: Date.now(),
      });
      this.edges.push({ source: fileNode.id, target: id, kind: 'contains' });

      // extract calls from body
      if (bodyStart >= 0 && bodyEnd >= 0) {
        const body = this.source.slice(bodyStart, bodyEnd + 1);
        this.extractCalls(id, body, line);
      }
      // advance regex past body
      if (bodyEnd >= 0) re.lastIndex = bodyEnd + 1;
    }
  }

  private extractCalls(fromId: string, body: string, baseLine: number): void {
    const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(body)) !== null) {
      const name = m[1]!;
      if (YH_KEYWORDS.has(name)) continue;
      const line = baseLine + body.slice(0, m.index).split('\n').length - 1;
      this.unresolvedReferences.push({
        fromNodeId: fromId,
        referenceName: name,
        referenceKind: 'calls',
        line,
        column: 0,
        filePath: this.filePath,
      });
    }
  }

  private findMatchingParen(openIdx: number): number {
    if (openIdx < 0 || this.source[openIdx] !== '(') return -1;
    let depth = 0;
    let inStr = false;
    let inLine = false;
    let inBlock = false;
    for (let i = openIdx; i < this.source.length; i++) {
      const c = this.source[i];
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && this.source[i + 1] === '/') { inBlock = false; i++; } continue; }
      if (inStr) { if (c === '\\') { i++; continue; } if (c === '"' || c === "'") inStr = false; continue; }
      if (c === '/') { if (this.source[i + 1] === '/') { inLine = true; i++; continue; } if (this.source[i + 1] === '*') { inBlock = true; i++; continue; } }
      if (c === '"' || c === "'") { inStr = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  private findMatchingBrace(openIdx: number): number {
    if (openIdx < 0 || this.source[openIdx] !== '{') return -1;
    let depth = 0;
    let inStr = false;
    let inLine = false;
    let inBlock = false;
    for (let i = openIdx; i < this.source.length; i++) {
      const c = this.source[i];
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && this.source[i + 1] === '/') { inBlock = false; i++; } continue; }
      if (inStr) { if (c === '\\') { i++; continue; } if (c === '"' || c === "'") inStr = false; continue; }
      if (c === '/') { if (this.source[i + 1] === '/') { inLine = true; i++; continue; } if (this.source[i + 1] === '*') { inBlock = true; i++; continue; } }
      if (c === '"' || c === "'") { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  private depthAt(idx: number): number {
    let depth = 0;
    let inStr = false;
    let inLine = false;
    let inBlock = false;
    for (let i = 0; i < idx; i++) {
      const c = this.source[i];
      if (inLine) { if (c === '\n') inLine = false; continue; }
      if (inBlock) { if (c === '*' && this.source[i + 1] === '/') { inBlock = false; i++; } continue; }
      if (inStr) { if (c === '\\') { i++; continue; } if (c === '"' || c === "'") inStr = false; continue; }
      if (c === '/') { if (this.source[i + 1] === '/') { inLine = true; i++; continue; } if (this.source[i + 1] === '*') { inBlock = true; i++; continue; } }
      if (c === '"' || c === "'") { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    return depth;
  }
}
