import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractSourcesJar, inspectJar } from '../../src/utils/jar-inspector.js';

function makeJar(entries: Array<{ name: string; content: string }>, outPath: string): void {
  const zip = new AdmZip();
  for (const e of entries) {
    zip.addFile(e.name, Buffer.from(e.content, 'utf8'));
  }
  zip.writeZip(outPath);
}

describe('jar-inspector', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'jar-inspector-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe('inspectJar', () => {
    it('returns "compiled" when any .class is present', () => {
      const jar = join(workDir, 'compiled.jar');
      makeJar(
        [
          { name: 'net/minecraft/Foo.class', content: 'BYTES' },
          { name: 'README.txt', content: 'hi' },
        ],
        jar,
      );
      const r = inspectJar(jar);
      expect(r.type).toBe('compiled');
      expect(r.classCount).toBe(1);
      expect(r.javaCount).toBe(0);
    });

    it('returns "sources" when only .java files are present', () => {
      const jar = join(workDir, 'sources.jar');
      makeJar(
        [
          { name: 'net/minecraft/Foo.java', content: 'class Foo {}' },
          { name: 'net/minecraft/Bar.java', content: 'class Bar {}' },
          { name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0' },
        ],
        jar,
      );
      const r = inspectJar(jar);
      expect(r.type).toBe('sources');
      expect(r.classCount).toBe(0);
      expect(r.javaCount).toBe(2);
    });

    it('classifies mixed JARs as "compiled" (any .class wins)', () => {
      const jar = join(workDir, 'mixed.jar');
      makeJar(
        [
          { name: 'a/A.class', content: 'BYTES' },
          { name: 'a/A.java', content: 'class A {}' },
        ],
        jar,
      );
      const r = inspectJar(jar);
      expect(r.type).toBe('compiled');
      expect(r.classCount).toBe(1);
      expect(r.javaCount).toBe(1);
    });

    it('returns "empty" when neither .class nor .java is present', () => {
      const jar = join(workDir, 'empty.jar');
      makeJar([{ name: 'assets/icon.png', content: 'PNG' }], jar);
      expect(inspectJar(jar).type).toBe('empty');
    });
  });

  describe('extractSourcesJar', () => {
    it('writes .java files preserving package structure and skips non-.java', () => {
      const jar = join(workDir, 'src.jar');
      makeJar(
        [
          { name: 'net/minecraft/Foo.java', content: 'package net.minecraft; class Foo {}' },
          { name: 'net/neoforged/Bar.java', content: 'package net.neoforged; class Bar {}' },
          { name: 'META-INF/MANIFEST.MF', content: 'ignored' },
          { name: 'assets/icon.png', content: 'ignored' },
        ],
        jar,
      );
      const out = join(workDir, 'out');
      const written = extractSourcesJar(jar, out);

      expect(written).toBe(2);
      expect(existsSync(join(out, 'net/minecraft/Foo.java'))).toBe(true);
      expect(existsSync(join(out, 'net/neoforged/Bar.java'))).toBe(true);
      expect(existsSync(join(out, 'META-INF/MANIFEST.MF'))).toBe(false);
      expect(existsSync(join(out, 'assets/icon.png'))).toBe(false);

      expect(readFileSync(join(out, 'net/minecraft/Foo.java'), 'utf8')).toContain('class Foo');
    });
  });
});
