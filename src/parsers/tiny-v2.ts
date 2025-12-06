import { readFileSync } from 'node:fs';
import { logger } from '../utils/logger.js';

/**
 * Tiny v2 mapping format
 * Spec: https://wiki.fabricmc.net/documentation:tiny2
 */

export interface TinyV2Header {
  majorVersion: number;
  minorVersion: number;
  namespaces: string[];
  properties: Map<string, string>;
}

export interface TinyV2Class {
  names: string[]; // One name per namespace
  comment?: string;
  fields: TinyV2Field[];
  methods: TinyV2Method[];
}

export interface TinyV2Field {
  descriptor: string;
  names: string[];
  comment?: string;
}

export interface TinyV2Method {
  descriptor: string;
  names: string[];
  comment?: string;
  parameters: TinyV2Parameter[];
  localVariables: TinyV2LocalVariable[];
}

export interface TinyV2Parameter {
  localVariableIndex: number;
  names: string[];
  comment?: string;
}

export interface TinyV2LocalVariable {
  localVariableIndex: number;
  localVariableStartOffset: number;
  localVariableTableIndex: number;
  names: string[];
  comment?: string;
}

export class TinyV2Parser {
  private lines: string[];
  private currentLine = 0;
  private header: TinyV2Header | null = null;

  constructor(content: string) {
    this.lines = content.split('\n').map((line) => line.trim());
  }

  parse(): { header: TinyV2Header; classes: TinyV2Class[] } {
    this.parseHeader();
    const classes = this.parseClasses();

    if (!this.header) {
      throw new Error('Failed to parse Tiny v2 header');
    }

    return { header: this.header, classes };
  }

  private parseHeader(): void {
    const line = this.lines[this.currentLine++];
    const parts = line.split('\t');

    if (parts[0] !== 'tiny') {
      throw new Error('Invalid Tiny v2 file: must start with "tiny"');
    }

    const [major, minor] = parts[1].split('.').map(Number);
    const namespaces = parts.slice(2);

    this.header = {
      majorVersion: major,
      minorVersion: minor,
      namespaces,
      properties: new Map(),
    };

    logger.debug(`Parsed Tiny v2 header: ${major}.${minor}, namespaces: ${namespaces.join(', ')}`);
  }

  private parseClasses(): TinyV2Class[] {
    const classes: TinyV2Class[] = [];

    while (this.currentLine < this.lines.length) {
      const line = this.lines[this.currentLine];
      if (!line || line.startsWith('#')) {
        this.currentLine++;
        continue;
      }

      if (line.startsWith('c\t')) {
        classes.push(this.parseClass());
      } else {
        this.currentLine++;
      }
    }

    return classes;
  }

  private parseClass(): TinyV2Class {
    const line = this.lines[this.currentLine++];
    const parts = line.split('\t');
    const names = parts.slice(1);

    const classData: TinyV2Class = {
      names,
      fields: [],
      methods: [],
    };

    // Parse fields and methods
    while (this.currentLine < this.lines.length) {
      const nextLine = this.lines[this.currentLine];
      if (!nextLine || nextLine.startsWith('c\t')) {
        break;
      }

      if (nextLine.startsWith('\tf\t')) {
        classData.fields.push(this.parseField());
      } else if (nextLine.startsWith('\tm\t')) {
        classData.methods.push(this.parseMethod());
      } else if (nextLine.startsWith('\tc\t')) {
        // Class comment
        this.currentLine++;
      } else {
        this.currentLine++;
      }
    }

    return classData;
  }

  private parseField(): TinyV2Field {
    const line = this.lines[this.currentLine++];
    const parts = line.trim().split('\t');
    const descriptor = parts[1];
    const names = parts.slice(2);

    return { descriptor, names };
  }

  private parseMethod(): TinyV2Method {
    const line = this.lines[this.currentLine++];
    const parts = line.trim().split('\t');
    const descriptor = parts[1];
    const names = parts.slice(2);

    const method: TinyV2Method = {
      descriptor,
      names,
      parameters: [],
      localVariables: [],
    };

    // Parse parameters and local variables (if present)
    while (this.currentLine < this.lines.length) {
      const nextLine = this.lines[this.currentLine];
      if (!nextLine || !nextLine.startsWith('\t\t')) {
        break;
      }
      this.currentLine++;
    }

    return method;
  }

  /**
   * Helper: Get name in specific namespace
   */
  static getName(names: string[], namespaces: string[], targetNamespace: string): string {
    const index = namespaces.indexOf(targetNamespace);
    if (index === -1) {
      throw new Error(`Namespace ${targetNamespace} not found`);
    }
    return names[index];
  }
}

/**
 * Parse Tiny v2 file
 */
export function parseTinyV2(filePath: string): { header: TinyV2Header; classes: TinyV2Class[] } {
  const content = readFileSync(filePath, 'utf8');
  const parser = new TinyV2Parser(content);
  return parser.parse();
}

/**
 * Build a mapping lookup table from Tiny v2
 */
export function buildMappingTable(
  tinyData: { header: TinyV2Header; classes: TinyV2Class[] },
  fromNamespace: string,
  toNamespace: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const fromIndex = tinyData.header.namespaces.indexOf(fromNamespace);
  const toIndex = tinyData.header.namespaces.indexOf(toNamespace);

  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(`Invalid namespaces: ${fromNamespace} -> ${toNamespace}`);
  }

  for (const cls of tinyData.classes) {
    const fromName = cls.names[fromIndex];
    const toName = cls.names[toIndex];
    map.set(fromName, toName);

    // Add field mappings
    for (const field of cls.fields) {
      const fromFieldName = field.names[fromIndex];
      const toFieldName = field.names[toIndex];
      map.set(`${fromName}.${fromFieldName}`, `${toName}.${toFieldName}`);
    }

    // Add method mappings
    for (const method of cls.methods) {
      const fromMethodName = method.names[fromIndex];
      const toMethodName = method.names[toIndex];
      map.set(`${fromName}.${fromMethodName}${method.descriptor}`, `${toName}.${toMethodName}`);
    }
  }

  return map;
}
