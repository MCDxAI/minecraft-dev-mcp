import { readFileSync } from 'node:fs';
import { logger } from '../utils/logger.js';

/**
 * ProGuard mapping format parser (used by Mojang mappings)
 * Format:
 * obfuscated.class.Name -> deobfuscated.class.Name:
 *     returnType obfuscatedMethod(params) -> deobfuscatedMethod
 *     fieldType obfuscatedField -> deobfuscatedField
 */

export interface ProGuardClass {
  obfuscated: string;
  deobfuscated: string;
  fields: ProGuardField[];
  methods: ProGuardMethod[];
}

export interface ProGuardField {
  obfuscated: string;
  deobfuscated: string;
  type: string;
}

export interface ProGuardMethod {
  obfuscated: string;
  deobfuscated: string;
  returnType: string;
  parameters: string;
}

export class ProGuardParser {
  private lines: string[];

  constructor(content: string) {
    this.lines = content.split('\n').map((line) => line.trimEnd());
  }

  parse(): ProGuardClass[] {
    const classes: ProGuardClass[] = [];
    let currentClass: ProGuardClass | null = null;

    for (const line of this.lines) {
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Class mapping: "obfuscated.Class -> deobfuscated.Class:"
      if (line.includes(' -> ') && line.endsWith(':')) {
        if (currentClass) {
          classes.push(currentClass);
        }
        currentClass = this.parseClassLine(line);
      }
      // Member mapping (field or method)
      else if (line.startsWith('    ') && currentClass) {
        const member = this.parseMemberLine(line);
        if (member.type === 'method') {
          currentClass.methods.push(member.data as ProGuardMethod);
        } else if (member.type === 'field') {
          currentClass.fields.push(member.data as ProGuardField);
        }
      }
    }

    if (currentClass) {
      classes.push(currentClass);
    }

    logger.debug(`Parsed ${classes.length} classes from ProGuard mappings`);
    return classes;
  }

  private parseClassLine(line: string): ProGuardClass {
    const match = line.match(/^(.+) -> (.+):$/);
    if (!match) {
      throw new Error(`Invalid ProGuard class line: ${line}`);
    }

    return {
      obfuscated: match[1].replace(/\./g, '/'),
      deobfuscated: match[2].replace(/\./g, '/'),
      fields: [],
      methods: [],
    };
  }

  private parseMemberLine(line: string): { type: 'method' | 'field'; data: ProGuardMethod | ProGuardField } {
    const trimmed = line.trim();

    // Method: "returnType methodName(params) -> deobfuscatedName"
    // Field: "fieldType fieldName -> deobfuscatedName"
    const match = trimmed.match(/^(.+?)\s+(.+?)\s+->\s+(.+)$/);
    if (!match) {
      throw new Error(`Invalid ProGuard member line: ${line}`);
    }

    const [, typeOrReturn, nameAndParams, deobfuscated] = match;

    // Check if it's a method (has parentheses)
    if (nameAndParams.includes('(')) {
      const methodMatch = nameAndParams.match(/^(.+?)\((.+)?\)$/);
      if (!methodMatch) {
        throw new Error(`Invalid method format: ${nameAndParams}`);
      }

      return {
        type: 'method',
        data: {
          obfuscated: methodMatch[1],
          deobfuscated,
          returnType: typeOrReturn,
          parameters: methodMatch[2] || '',
        },
      };
    }

    // It's a field
    return {
      type: 'field',
      data: {
        obfuscated: nameAndParams,
        deobfuscated,
        type: typeOrReturn,
      },
    };
  }
}

/**
 * Parse ProGuard mapping file
 */
export function parseProGuard(filePath: string): ProGuardClass[] {
  const content = readFileSync(filePath, 'utf8');
  const parser = new ProGuardParser(content);
  return parser.parse();
}

/**
 * Build a mapping lookup table from ProGuard mappings
 */
export function buildProGuardMappingTable(
  classes: ProGuardClass[],
  reverse = false,
): Map<string, string> {
  const map = new Map<string, string>();

  for (const cls of classes) {
    const fromClass = reverse ? cls.deobfuscated : cls.obfuscated;
    const toClass = reverse ? cls.obfuscated : cls.deobfuscated;

    map.set(fromClass, toClass);

    // Add field mappings
    for (const field of cls.fields) {
      const fromField = reverse ? field.deobfuscated : field.obfuscated;
      const toField = reverse ? field.obfuscated : field.deobfuscated;
      map.set(`${fromClass}.${fromField}`, `${toClass}.${toField}`);
    }

    // Add method mappings
    for (const method of cls.methods) {
      const fromMethod = reverse ? method.deobfuscated : method.obfuscated;
      const toMethod = reverse ? method.obfuscated : method.deobfuscated;
      map.set(`${fromClass}.${fromMethod}`, `${toClass}.${toMethod}`);
    }
  }

  return map;
}
