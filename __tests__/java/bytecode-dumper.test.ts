import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBytecodeDumper } from '../../src/java/bytecode-dumper.js';
import type { BytecodeClass } from '../../src/java/bytecode-dumper.js';

// Resolve the bundled jar the same way the wrapper does. Skip the whole suite if it isn't built
// (the jar is a dev/CI prerequisite, exactly like mapping-io-cli).
const __dirname = dirname(fileURLToPath(import.meta.url));
const JAR_PATH = join(
  __dirname,
  '..',
  '..',
  'tools',
  'bytecode-dumper',
  'build',
  'libs',
  'bytecode-dumper-1.0.0.jar',
);

/** Resolve javac, preferring JAVA_HOME/bin (mirrors the wrapper's java resolution). */
function getJavacExecutable(): string | null {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const candidate = join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH. spawnSync with shell:false probes PATH directly.
  const probe = spawnSync(process.platform === 'win32' ? 'javac.exe' : 'javac', ['-version'], {
    stdio: 'ignore',
  });
  return probe.status === 0 || probe.error === undefined ? 'javac' : null;
}

const JAVAC = getJavacExecutable();

// Fixture exercising records, a static inner class, a sealed interface with permitted
// subclasses, a generic class, a ConstantValue field, and a method with a `throws` clause.
// Each rare-but-documented bytecode feature below is positively asserted in the suite.
const FIXTURE_SOURCE = `
public final class Fixture {
  // ConstantValue field: ACC_PUBLIC | ACC_STATIC | ACC_FINAL with a constant int initializer.
  public static final int ANSWER = 42;

  public record Point(int x, int y) {
    public Point {
      if (x < 0) throw new IllegalArgumentException();
    }
    public int sum() { return x + y; }
  }

  public static class Inner implements Runnable {
    private final String name;
    public Inner(String name) { this.name = name; }
    @Override public void run() { System.out.println(name); }
  }
}

// Sealed interface + permitted record subclasses (the issue-#12 access-transformer use case).
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}

// Generic class: emits a Signature attribute distinct from the erased descriptor.
class Box<T> {
  T value;
}

// Class with a checked throws clause: the dumper must surface the Exceptions attribute.
class Risky {
  void risky() throws java.io.IOException {}
}
`;

interface Fixture {
  dir: string;
  pointClass: string;
  innerClass: string;
  fixtureClass: string;
  jarPath: string;
  shapeClass: string;
  riskyClass: string;
  boxClass: string;
}

/** Compile the fixture into a temp dir with javac; returns paths. Throws if javac unavailable. */
function compileFixture(): Fixture {
  if (!JAVAC) {
    throw new Error('javac not available — cannot compile the bytecode-dumper fixture');
  }
  const dir = mkdtempSync(join(tmpdir(), 'bcd-test-'));
  const sourcePath = join(dir, 'Fixture.java');
  writeFileSync(sourcePath, FIXTURE_SOURCE);

  // --release 17 keeps the class files at version 61 (records supported) and stable across JDKs.
  const result = spawnSync(JAVAC, ['--release', '17', '-d', dir, sourcePath], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`javac failed (status ${result.status}): ${result.stderr}`);
  }

  return {
    dir,
    pointClass: join(dir, 'Fixture$Point.class'),
    innerClass: join(dir, 'Fixture$Inner.class'),
    fixtureClass: join(dir, 'Fixture.class'),
    jarPath: join(dir, 'Fixture.jar'),
    shapeClass: join(dir, 'Shape.class'),
    riskyClass: join(dir, 'Risky.class'),
    boxClass: join(dir, 'Box.class'),
  };
}

// Skip the entire suite when the jar isn't built (CI/dev prerequisite) — same approach the mod
// tools use for the remapped-JAR fixture. Also requires javac to compile the fixture at test time.
const describeWithPrereqs = existsSync(JAR_PATH) && JAVAC !== null ? describe : describe.skip;

describeWithPrereqs('BytecodeDumper (bundled ASM dumper)', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = compileFixture();
    // Package the compiled classes into a JAR to also exercise JAR-iteration + file-output modes.
    // All 8 classes: Fixture, Fixture$Point, Fixture$Inner, Shape, Circle, Square, Box, Risky.
    const jarResult = spawnSync(
      process.platform === 'win32' ? 'jar.exe' : 'jar',
      [
        'cf',
        fixture.jarPath,
        'Fixture.class',
        'Fixture$Point.class',
        'Fixture$Inner.class',
        'Shape.class',
        'Circle.class',
        'Square.class',
        'Box.class',
        'Risky.class',
      ],
      { cwd: fixture.dir, stdio: 'pipe', encoding: 'utf8' },
    );
    if (jarResult.status !== 0) {
      throw new Error(`jar packaging failed: ${jarResult.stderr}`);
    }
  });

  afterAll(() => {
    if (fixture) {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it('dumps a record class with correct flags, components, and canonical constructor', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.pointClass);

    expect(dump.classes).toHaveLength(1);
    const cls = dump.classes[0] as BytecodeClass;

    expect(cls.name).toBe('Fixture$Point');
    expect(cls.isRecord).toBe(true);
    expect(cls.isFinal).toBe(true);
    expect(cls.isSealed).toBe(false);
    expect(cls.isInterface).toBe(false);
    expect(cls.isEnum).toBe(false);
    expect(cls.isAnnotation).toBe(false);
    expect(cls.superName).toBe('java/lang/Record');

    // Records: ACC_PUBLIC | ACC_FINAL | ACC_SUPER | ACC_RECORD = 0x10031 = 65585.
    expect(cls.access).toBe(0x10031);

    // Target-aware decoding: ACC_SUPER -> "super", ACC_RECORD -> "record" (no "synchronized").
    expect(cls.flags).toEqual(expect.arrayContaining(['public', 'final', 'super', 'record']));
    expect(cls.flags).not.toContain('synchronized');

    // Record components drive the canonical constructor.
    expect(cls.recordComponents).not.toBeNull();
    expect(cls.recordComponents).toEqual([
      { name: 'x', descriptor: 'I', signature: null },
      { name: 'y', descriptor: 'I', signature: null },
    ]);
    expect(cls.canonicalConstructor).toBe('(II)V');

    // The canonical <init> must be present with the matching descriptor.
    const init = cls.methods.find((m) => m.name === '<init>');
    expect(init).toBeDefined();
    expect(init?.desc).toBe('(II)V');
    expect(init?.flags).toContain('public');

    // Record accessor fields are private final.
    const xField = cls.fields.find((f) => f.name === 'x');
    expect(xField).toBeDefined();
    expect(xField?.desc).toBe('I');
    expect(xField?.flags).toEqual(['private', 'final']);
  });

  it('reports the nest host and inner-class relationship', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.pointClass);
    const cls = dump.classes[0] as BytecodeClass;

    expect(cls.nestHost).toBe('Fixture');

    // The record itself appears as an inner class of Fixture.
    const self = cls.innerClasses.find((ic) => ic.name === 'Fixture$Point');
    expect(self).toBeDefined();
    expect(self?.outerName).toBe('Fixture');
    expect(self?.innerName).toBe('Point');
    // ACC_PUBLIC | ACC_STATIC | ACC_FINAL.
    expect(self?.access).toBe(0x19);
    expect(self?.flags).toEqual(expect.arrayContaining(['public', 'static', 'final']));
    // Inner-class flags must NOT include class/field/method-only bits.
    expect(self?.flags).not.toContain('super');
  });

  it('parses a static inner class with a Runnable interface', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.innerClass);
    const cls = dump.classes[0] as BytecodeClass;

    expect(cls.name).toBe('Fixture$Inner');
    expect(cls.isRecord).toBe(false);
    expect(cls.recordComponents).toBeNull();
    expect(cls.canonicalConstructor).toBeNull();
    expect(cls.interfaces).toContain('java/lang/Runnable');
    expect(cls.nestHost).toBe('Fixture');

    // Constructor <init>(String).
    const init = cls.methods.find((m) => m.name === '<init>' && m.desc === '(Ljava/lang/String;)V');
    expect(init).toBeDefined();
    expect(init?.flags).toContain('public');

    // run() is public (overrides Runnable); @Override adds nothing to bytecode flags.
    const run = cls.methods.find((m) => m.name === 'run');
    expect(run).toBeDefined();
    expect(run?.desc).toBe('()V');
    expect(run?.flags).toContain('public');
  });

  it('reports a sealed interface with its permitted subclasses (issue #12)', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.shapeClass);
    const cls = dump.classes[0] as BytecodeClass;

    expect(cls.name).toBe('Shape');
    expect(cls.isInterface).toBe(true);
    expect(cls.isAbstract).toBe(true);
    // There is no ACC_SEALED flag: isSealed is derived from permittedSubclasses !== null.
    expect(cls.isSealed).toBe(true);
    // Internal names (no package here), in the `permits` declaration order.
    expect(cls.permittedSubclasses).toEqual(['Circle', 'Square']);
  });

  it('captures a method throws clause in the Exceptions attribute', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.riskyClass);
    const cls = dump.classes[0] as BytecodeClass;

    const risky = cls.methods.find((m) => m.name === 'risky');
    expect(risky).toBeDefined();
    expect(risky?.desc).toBe('()V');
    // Internal names (slashes), no ".class" suffix.
    expect(risky?.exceptions).toEqual(['java/io/IOException']);
  });

  it('emits a ConstantValue for a static final primitive field', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.fixtureClass);
    const cls = dump.classes[0] as BytecodeClass;

    const answer = cls.fields.find((f) => f.name === 'ANSWER');
    expect(answer).toBeDefined();
    expect(answer?.desc).toBe('I');
    expect(answer?.flags).toEqual(['public', 'static', 'final']);
    // ConstantValue attribute is decoded into the literal initializer.
    expect(answer?.value).toBe(42);
  });

  it('emits a generic Signature that differs from the erased descriptor', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.boxClass);
    const cls = dump.classes[0] as BytecodeClass;

    // Class-level generic signature (<T:Ljava/lang/Object;>Ljava/lang/Object;) is populated.
    expect(cls.signature).not.toBeNull();
    expect(typeof cls.signature).toBe('string');

    const valueField = cls.fields.find((f) => f.name === 'value');
    expect(valueField).toBeDefined();
    // Erased descriptor vs generic signature must differ (desc has no type parameter).
    expect(valueField?.desc).toBe('Ljava/lang/Object;');
    expect(valueField?.signature).toBe('TT;');
    expect(valueField?.signature).not.toBe(valueField?.desc);
  });

  it('populates nestMembers on the nest host (complements nestHost)', async () => {
    const dumper = getBytecodeDumper();
    const dump = await dumper.dump(fixture.fixtureClass);
    const cls = dump.classes[0] as BytecodeClass;

    // Fixture is itself the nest host, so its own nestHost attribute is absent (null).
    expect(cls.nestHost).toBeNull();
    expect(cls.nestMembers).not.toBeNull();
    expect(cls.nestMembers).toEqual(expect.arrayContaining(['Fixture$Point', 'Fixture$Inner']));
    expect(cls.nestMembers).toHaveLength(2);
  });

  it('iterates a JAR and supports file-output mode (2 args)', async () => {
    const dumper = getBytecodeDumper();
    const outPath = join(fixture.dir, 'dump.json');

    const dump = await dumper.dump(fixture.jarPath, { outputPath: outPath });

    // JAR contains exactly 8 classes: Fixture, Fixture$Point, Fixture$Inner, Shape, Circle,
    // Square, Box, Risky. Exact count — a regression dropping or duplicating a class must fail.
    expect(dump.classes.length).toBe(8);
    const names = dump.classes.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Fixture',
        'Fixture$Point',
        'Fixture$Inner',
        'Shape',
        'Circle',
        'Square',
        'Box',
        'Risky',
      ]),
    );

    // File-output mode: the wrapper read JSON back from disk.
    expect(existsSync(outPath)).toBe(true);
    const fromDisk = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(fromDisk.classes.length).toBe(dump.classes.length);

    // The record is still correctly detected when iterating inside a JAR.
    const point = dump.classes.find((c) => c.name === 'Fixture$Point') as BytecodeClass;
    expect(point?.isRecord).toBe(true);
    expect(point?.canonicalConstructor).toBe('(II)V');
  });

  it('rejects a non-existent input with a BytecodeDumpError', async () => {
    const dumper = getBytecodeDumper();
    await expect(dumper.dump(join(fixture.dir, 'does-not-exist.class'))).rejects.toThrow(
      /BytecodeDumper/i,
    );
  });
});

// Separate top-level suite that always runs, to document the skip when a prerequisite is missing.
describe('BytecodeDumper prerequisites', () => {
  it('reports whether the bundled jar is built and javac is available', () => {
    if (!existsSync(JAR_PATH)) {
      console.warn(
        `[bytecode-dumper.test] Skipping integration assertions: bundled jar not built at ${JAR_PATH}. Build it with: cd tools/bytecode-dumper && ./gradlew shadowJar`,
      );
    }
    if (!JAVAC) {
      console.warn(
        '[bytecode-dumper.test] Skipping integration assertions: javac not found on PATH (or JAVA_HOME).',
      );
    }
    expect(typeof JAR_PATH).toBe('string');
  });
});
