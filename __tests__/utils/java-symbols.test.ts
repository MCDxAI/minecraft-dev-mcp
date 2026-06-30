import { describe, expect, it } from 'vitest';
import {
  type JavaAnnotation,
  type JavaSymbol,
  extractJavaSignatures,
  extractJavaSymbols,
} from '../../src/utils/java-symbols.js';

/**
 * Regression tests for https://github.com/MCDxAI/minecraft-dev-mcp/issues/11
 *
 * The previous line-based regex dropped method/field declarations whose types
 * contained a dot (qualified/inner types), a space (generics), or a leading
 * annotation, plus all constructors, and it mis-attributed methods from
 * anonymous classes to the enclosing top-level class. These tests pin the
 * tree-sitter-based behavior that fixes both.
 */
describe('extractJavaSymbols', () => {
  it('captures the issue #11 BlockPos cases (primary bug)', () => {
    const source = `package net.minecraft.core;
public class BlockPos {
   public static final StreamCodec<ByteBuf, BlockPos> STREAM_CODEC = new StreamCodec<ByteBuf, BlockPos>() {
      public BlockPos decode(final ByteBuf input) { return null; }
      public void encode(final ByteBuf output, BlockPos value) {}
   };
   public static Iterable<BlockPos.MutableBlockPos> spiralAround(BlockPos center, int radius,
         Direction firstDirection, Direction secondDirection) { return null; }
   public @Nullable Channel acquire() { return null; }
   public BlockPos(int x, int y, int z) {}
   private Map<String, Integer> multiField; }`;

    const symbols = extractJavaSymbols(source);
    const has = (entryType: 'class' | 'method' | 'field', symbol: string, declaring?: string) =>
      symbols.some(
        (s) =>
          s.entryType === entryType &&
          s.symbol === symbol &&
          (!declaring || s.declaringClass === declaring),
      );

    // spiralAround was dropped by the old regex (qualified generic return type).
    expect(has('method', 'spiralAround', 'net.minecraft.core.BlockPos')).toBe(true);
    // STREAM_CODEC field was dropped (its initializer contains '(').
    expect(has('field', 'STREAM_CODEC', 'net.minecraft.core.BlockPos')).toBe(true);
    // Type-annotated method was dropped.
    expect(has('method', 'acquire', 'net.minecraft.core.BlockPos')).toBe(true);
    // Constructor was dropped (no return type).
    expect(has('method', 'BlockPos', 'net.minecraft.core.BlockPos')).toBe(true);
    // Generic field with space was dropped.
    expect(has('field', 'multiField', 'net.minecraft.core.BlockPos')).toBe(true);
  });

  it('excludes methods declared inside anonymous classes (secondary bug)', () => {
    const source = `package x;
public class BlockPos {
   public static final StreamCodec<ByteBuf, BlockPos> STREAM_CODEC = new StreamCodec<ByteBuf, BlockPos>() {
      public BlockPos decode(final ByteBuf input) { return null; }
      public void encode(final ByteBuf output, BlockPos value) {}
   }; }`;

    const symbols = extractJavaSymbols(source);

    // The real STREAM_CODEC field is indexed...
    expect(symbols.some((s) => s.entryType === 'field' && s.symbol === 'STREAM_CODEC')).toBe(true);
    // ...but the anonymous-class decode/encode are NOT mis-attributed to BlockPos.
    expect(symbols.some((s) => s.symbol === 'decode')).toBe(false);
    expect(symbols.some((s) => s.symbol === 'encode')).toBe(false);
  });

  it('attributes nested named class members to the nested class', () => {
    const source = `package net.minecraft.core;
public class BlockPos {
   public class MutableBlockPos extends BlockPos { public int getX() { return 0; } } }`;

    const symbols = extractJavaSymbols(source);
    const mutable = symbols.find((s) => s.entryType === 'class' && s.symbol === 'MutableBlockPos');
    expect(mutable?.declaringClass).toBe('net.minecraft.core.BlockPos.MutableBlockPos');
    expect(
      symbols.some(
        (s) =>
          s.entryType === 'method' &&
          s.symbol === 'getX' &&
          s.declaringClass === 'net.minecraft.core.BlockPos.MutableBlockPos',
      ),
    ).toBe(true);
  });

  it('handles enums, records, interfaces, and abstract methods', () => {
    const source = `package x;
public sealed interface Shape permits Square {}
enum Color { RED(1), GREEN(2); Color(int c){} public int code(){return 0;} }
public record Point(int x, int y) { public Point { } public int x(){return x;} }
abstract class Abs { abstract void doIt(); int a, b = 2; }`;

    const symbols = extractJavaSymbols(source);
    const has = (e: 'class' | 'method' | 'field', s: string) =>
      symbols.some((sym) => sym.entryType === e && sym.symbol === s);

    // enum constants -> field entries
    expect(has('field', 'RED')).toBe(true);
    expect(has('field', 'GREEN')).toBe(true);
    expect(has('method', 'code')).toBe(true);
    // record compact constructor + accessor
    expect(has('method', 'Point')).toBe(true);
    expect(has('method', 'x')).toBe(true);
    // abstract method (no body) + multi-declarator field
    expect(has('method', 'doIt')).toBe(true);
    expect(has('field', 'a')).toBe(true);
    expect(has('field', 'b')).toBe(true);
  });

  it('indexes interface constants (constant_declaration) and annotation-type elements', () => {
    // `constant_declaration` is a distinct node type from `field_declaration`
    // used for interface constants; both must be captured.
    const source = `package x;
public interface Flags {
   int A = 1, B = 2;
   String NAME = "flags";
   default void run() {}
   interface Nested { long ID = 99L; }
}
public @interface Marker {
   String value() default "";
   int count() default 0;
}`;

    const symbols = extractJavaSymbols(source);
    const has = (e: 'class' | 'method' | 'field', s: string, decl?: string) =>
      symbols.some(
        (sym) => sym.entryType === e && sym.symbol === s && (!decl || sym.declaringClass === decl),
      );

    // Interface constants (multi-declarator + single).
    expect(has('field', 'A', 'x.Flags')).toBe(true);
    expect(has('field', 'B', 'x.Flags')).toBe(true);
    expect(has('field', 'NAME', 'x.Flags')).toBe(true);
    // Interface default method.
    expect(has('method', 'run', 'x.Flags')).toBe(true);
    // Nested interface constant is attributed to the nested type.
    expect(has('field', 'ID', 'x.Flags.Nested')).toBe(true);
    // Annotation-type elements (annotation_type_element_declaration) -> methods.
    expect(has('method', 'value', 'x.Marker')).toBe(true);
    expect(has('method', 'count', 'x.Marker')).toBe(true);
  });

  it('returns an empty array for unparseable / non-java content', () => {
    expect(extractJavaSymbols('')).toEqual([]);
    expect(extractJavaSymbols('not really java at all {} ( )')).toBeDefined();
  });
});

describe('extractJavaSymbols — structured fields', () => {
  it('captures method generics, qualified/varargs params, throws, and modifiers', () => {
    const source = `package net.example;
import java.io.IOException;
public class Repo {
  @Override
  public static <T extends Number> Map<String, T> load(int id, String... keys) throws IOException, RuntimeException {
    return null;
  }
}`;
    const symbols = extractJavaSymbols(source);
    const m = symbols.find((s) => s.entryType === 'method' && s.symbol === 'load');
    expect(m).toBeDefined();
    expect(m?.modifiers).toEqual(['public', 'static']);
    expect(m?.isStatic).toBe(true);
    expect(m?.returnType).toBe('Map<String, T>');
    expect(m?.typeParameters).toBe('<T extends Number>');
    expect(m?.parameters).toEqual([
      { name: 'id', type: 'int' },
      { name: 'keys', type: 'String', isVarArgs: true },
    ]);
    expect(m?.throws).toEqual(['IOException', 'RuntimeException']);
    expect(m?.annotations?.map((a) => a.descriptor)).toEqual(['Override']);
  });

  it('captures multi-declarator fields with shared type and per-declarator values', () => {
    const source = `package x;
public class Cfg {
  public static final int A = 1, B = 2, C;
}`;
    const symbols = extractJavaSymbols(source);
    const fields = symbols.filter(
      (s): s is JavaSymbol => s.entryType === 'field' && ['A', 'B', 'C'].includes(s.symbol),
    );
    expect(fields.map((f) => f.symbol).sort()).toEqual(['A', 'B', 'C']);
    for (const f of fields) {
      expect(f.fieldType).toBe('int');
      expect(f.modifiers).toEqual(['public', 'static', 'final']);
      expect(f.isFinal).toBe(true);
    }
    const sig = extractJavaSignatures(source)[0];
    const sigFields = Object.fromEntries(sig.fields.map((f) => [f.name, f]));
    expect(sigFields.A.constantValue).toBe('1');
    expect(sigFields.B.constantValue).toBe('2');
    expect(sigFields.C.constantValue).toBeUndefined();
  });

  it('marks constructors and omits their return type', () => {
    const source = `package x;
public class Vec {
  public Vec(int x, int y) {}
}`;
    const symbols = extractJavaSymbols(source);
    const ctor = symbols.find((s) => s.entryType === 'method' && s.symbol === 'Vec');
    expect(ctor?.isConstructor).toBe(true);
    expect(ctor?.returnType).toBeUndefined();
    expect(ctor?.parameters).toEqual([
      { name: 'x', type: 'int' },
      { name: 'y', type: 'int' },
    ]);
  });

  it('captures class kind, generics, superclass, and generic interfaces', () => {
    const source = `package net.example;
public abstract class Foo<T extends Number> extends Base implements Runnable, java.util.Comparator<Foo> {
  abstract void run();
}`;
    const symbols = extractJavaSymbols(source);
    const cls = symbols.find((s) => s.entryType === 'class' && s.symbol === 'Foo');
    expect(cls?.kind).toBe('class');
    expect(cls?.modifiers).toEqual(['public', 'abstract']);
    expect(cls?.typeParameters).toBe('<T extends Number>');
    expect(cls?.superclass).toBe('Base');
    // Generic interface with an internal comma must NOT be split.
    expect(cls?.interfaces).toEqual(['Runnable', 'java.util.Comparator<Foo>']);
  });

  it('captures record components and implicit enum-constant modifiers', () => {
    const source = `package x;
public record Point(int x, int y) {
  public Point {}
  public int x() { return x; }
}
public enum Color { RED, GREEN(1);
  Color(int c){}
  public int code(){return 0;}
}`;
    const symbols = extractJavaSymbols(source);
    const point = symbols.find((s) => s.entryType === 'class' && s.symbol === 'Point');
    expect(point?.kind).toBe('record');
    expect(point?.recordComponents).toEqual([
      { name: 'x', type: 'int' },
      { name: 'y', type: 'int' },
    ]);
    const red = symbols.find((s) => s.entryType === 'field' && s.symbol === 'RED');
    expect(red?.modifiers).toEqual(['public', 'static', 'final']);
    expect(red?.isStatic).toBe(true);
  });
});

describe('extractJavaSignatures — ClassSignature mapping', () => {
  it('groups members into a ClassSignature with methods, fields, and inheritance', () => {
    const source = `package net.example;
import java.io.IOException;
public class Repo extends Base implements Runnable {
  public static final String NAME = "repo";
  public <T> T get(int id) throws IOException { return null; }
  public Repo() {}
}`;
    const sigs = extractJavaSignatures(source);
    expect(sigs).toHaveLength(1);
    const sig = sigs[0];
    expect(sig.name).toBe('net.example.Repo');
    expect(sig.package).toBe('net.example');
    expect(sig.simpleName).toBe('Repo');
    expect(sig.isInterface).toBe(false);
    expect(sig.isEnum).toBe(false);
    expect(sig.isAbstract).toBe(false);
    expect(sig.superclass).toBe('Base');
    expect(sig.interfaces).toEqual(['Runnable']);

    const ctor = sig.methods.find((m) => m.name === 'Repo');
    expect(ctor).toBeDefined();
    expect(ctor?.returnType).toBe('');
    expect(ctor?.parameters).toEqual([]);
    expect(ctor?.modifiers).toEqual(['public']);

    const get = sig.methods.find((m) => m.name === 'get');
    expect(get?.returnType).toBe('T');
    expect(get?.parameters).toEqual(['int']);
    expect(get?.throws).toEqual(['IOException']);
    expect(get?.typeParameters).toEqual(['T']);

    const name = sig.fields.find((f) => f.name === 'NAME');
    expect(name?.type).toBe('String');
    expect(name?.modifiers).toEqual(['public', 'static', 'final']);
    expect(name?.constantValue).toBe('"repo"');
  });

  it('emits a ClassSignature per nested type and uses $ for innerClasses', () => {
    const source = `package net.example;
public class Outer {
  public class Inner {
    public class Deep {}
  }
}`;
    const sigs = extractJavaSignatures(source);
    const byName = Object.fromEntries(sigs.map((s) => [s.name, s]));
    expect(Object.keys(byName).sort()).toEqual([
      'net.example.Outer',
      'net.example.Outer.Inner',
      'net.example.Outer.Inner.Deep',
    ]);
    expect(byName['net.example.Outer.Inner'].simpleName).toBe('Inner');
    expect(byName['net.example.Outer'].innerClasses).toEqual(['net.example.Outer$Inner']);
    expect(byName['net.example.Outer.Inner'].innerClasses).toEqual([
      'net.example.Outer$Inner$Deep',
    ]);
  });

  it('marks records and interfaces and reflects abstract/final modifiers', () => {
    const source = `package x;
public interface Shape { default int sides(){return 0;} }
public final class Square implements Shape { public int sides(){return 4;} }
public abstract class Hollow {}
public record P(int a) {}`;
    const sigs = extractJavaSignatures(source);
    const byName = Object.fromEntries(sigs.map((s) => [s.simpleName, s]));
    expect(byName.Shape.isInterface).toBe(true);
    expect(byName.Square.isFinal).toBe(true);
    expect(byName.Hollow.isAbstract).toBe(true);
    expect(byName.P.isRecord).toBe(true);
    expect(byName.P.recordComponents).toEqual([{ name: 'a', type: 'int' }]);
  });
});

describe('extractJavaSignatures — sealed permits clause', () => {
  it('captures the permits list of a sealed class', () => {
    const source = `package x;
public sealed class Shape permits Circle, Square {}`;
    const sig = extractJavaSignatures(source)[0];
    expect(sig.simpleName).toBe('Shape');
    expect(sig.permits).toEqual(['Circle', 'Square']);

    // The `sealed` keyword survives in the flat symbol's modifiers.
    const cls = extractJavaSymbols(source).find(
      (s) => s.entryType === 'class' && s.symbol === 'Shape',
    );
    expect(cls?.modifiers).toContain('sealed');
  });

  it('captures the permits list of a sealed interface', () => {
    const source = `package x;
public sealed interface IShape permits A, B, C {}`;
    const sig = extractJavaSignatures(source)[0];
    expect(sig.permits).toEqual(['A', 'B', 'C']);
  });

  it('omits permits (undefined) for non-sealed classes and interfaces', () => {
    const source = `package x;
public class Plain {}
public interface Iface {}
public non-sealed class Sub extends Plain {}`;
    const byName = Object.fromEntries(extractJavaSignatures(source).map((s) => [s.simpleName, s]));
    // permits is emitted as undefined when the clause is absent (additive field).
    expect(byName.Plain.permits).toBeUndefined();
    expect(byName.Iface.permits).toBeUndefined();
    expect(byName.Sub.permits).toBeUndefined();
  });

  it('preserves qualified permitted names with dots', () => {
    const source = `package x;
public sealed class Shape permits net.mc.Circle, net.mc.Square {}`;
    const sig = extractJavaSignatures(source)[0];
    expect(sig.permits).toEqual(['net.mc.Circle', 'net.mc.Square']);
  });

  it('preserves a generic permitted name verbatim', () => {
    // Mirrors extractInterfaces: each type_list child's .text keeps its
    // generic arguments rather than splitting on the inner comma.
    const source = `package x;
public sealed class BoxHolder permits Box<Number>, Other {}`;
    const sig = extractJavaSignatures(source)[0];
    expect(sig.permits).toEqual(['Box<Number>', 'Other']);
  });
});

describe('extractJavaSignatures — package resolution', () => {
  it('resolves the package via the grammar name field, not a regex (bug #3c)', () => {
    // A class declared under a multi-segment package must be fully qualified.
    const source = `package net.minecraft.test;
public class Thing {}`;
    const sig = extractJavaSignatures(source)[0];
    expect(sig.package).toBe('net.minecraft.test');
    expect(sig.name).toBe('net.minecraft.test.Thing');

    const sym = extractJavaSymbols(source).find((s) => s.entryType === 'class');
    expect(sym?.declaringClass).toBe('net.minecraft.test.Thing');
  });
});
describe('extractJavaSymbols — structured annotation model', () => {
  /** Find the first annotation with the given simple name on a symbol. */
  /** Find the first annotation with the given simple name on a symbol. */
  const findAnno = (
    syms: JavaSymbol[],
    simple: string,
    entryType?: 'method' | 'field' | 'class',
  ): JavaAnnotation | undefined => {
    const pred = entryType ? (s: JavaSymbol) => s.entryType === entryType : () => true;
    for (const s of syms) {
      if (!pred(s)) continue;
      const a = s.annotations?.find((x) => x.descriptor.split('.').pop() === simple);
      if (a) return a;
    }
    return undefined;
  };

  it('parses a bare class-array argument (@Mixin({A.class, B.class}))', () => {
    const src = `package x;
@org.spongepowered.asm.mixin.Mixin({Entity.class, net.mc.LivingEntity.class})
public class M {}`;
    const anno = findAnno(extractJavaSymbols(src), 'Mixin', 'class');
    expect(anno?.parsed?.elementValue).toEqual({
      kind: 'array',
      value: [
        { kind: 'class', value: 'Entity' },
        { kind: 'class', value: 'net.mc.LivingEntity' },
      ],
    });
    expect(anno?.parsed?.elementValuePairs).toEqual({});
  });

  it('parses named args with a nested annotation (@Inject(method="tick", at=@At("HEAD")))', () => {
    const src = `package x;
public class M {
  @org.spongepowered.asm.mixin.injection.Inject(method = "tick", at = @At("HEAD"))
  public void onTick() {}
}`;
    const anno = findAnno(extractJavaSymbols(src), 'Inject', 'method');
    expect(anno?.parsed?.elementValuePairs.method).toEqual({ kind: 'string', value: 'tick' });
    const at = anno?.parsed?.elementValuePairs.at;
    expect(at?.kind).toBe('annotation');
    if (at?.kind === 'annotation') {
      expect(at.value.name).toBe('At');
      expect(at.value.elementValue).toEqual({ kind: 'string', value: 'HEAD' });
    }
  });

  it('parses a bare single-string argument (@Accessor("size"))', () => {
    const src = `package x;
public class M {
  @org.spongepowered.asm.mixin.gen.Accessor("size")
  public int getSize() { return 0; }
}`;
    const anno = findAnno(extractJavaSymbols(src), 'Accessor', 'method');
    expect(anno?.parsed?.elementValue).toEqual({ kind: 'string', value: 'size' });
  });

  it('parses a marker annotation (bare @Shadow) with an empty elementValuePairs map', () => {
    const src = `package x;
public class M {
  @org.spongepowered.asm.mixin.Shadow
  private int age;
}`;
    const anno = findAnno(extractJavaSymbols(src), 'Shadow', 'field');
    expect(anno?.parsed).toEqual({
      name: 'org.spongepowered.asm.mixin.Shadow',
      elementValuePairs: {},
    });
    expect(anno?.parsed?.elementValue).toBeUndefined();
  });

  it('parses stacked marker annotations (@Shadow @Mutable)', () => {
    const src = `package x;
public class M {
  @org.spongepowered.asm.mixin.Shadow @Mutable
  private int age;
}`;
    const field = extractJavaSymbols(src).find(
      (s) => s.entryType === 'field' && s.symbol === 'age',
    );
    expect(field?.annotations?.map((a) => a.descriptor.split('.').pop())).toEqual([
      'Shadow',
      'Mutable',
    ]);
  });

  it('parses a nested @At named-arg form (value="INVOKE", target="Lx;y()V")', () => {
    const src = `package x;
public class M {
  @Inject(at = @At(value = "INVOKE", target = "Lx;y()V"))
  public void onInvoke() {}
}`;
    const at = findAnno(extractJavaSymbols(src), 'Inject', 'method')?.parsed?.elementValuePairs.at;
    expect(at?.kind).toBe('annotation');
    if (at?.kind === 'annotation') {
      expect(at.value.elementValuePairs.value).toEqual({ kind: 'string', value: 'INVOKE' });
      expect(at.value.elementValuePairs.target).toEqual({ kind: 'string', value: 'Lx;y()V' });
    }
  });

  it('parses boolean and number element values (cancellable=true, priority=500)', () => {
    const injectSrc = `package x;
public class M {
  @Inject(cancellable = true)
  public void onInject() {}
}`;
    expect(
      findAnno(extractJavaSymbols(injectSrc), 'Inject', 'method')?.parsed?.elementValuePairs
        .cancellable,
    ).toEqual({ kind: 'boolean', value: true });

    const mixinSrc = `package x;
@org.spongepowered.asm.mixin.Mixin(value = Entity.class, priority = 500)
public class M2 {}`;
    expect(
      findAnno(extractJavaSymbols(mixinSrc), 'Mixin', 'class')?.parsed?.elementValuePairs.priority,
    ).toEqual({ kind: 'number', value: 500 });
  });

  it('parses a string-array argument (method = {"a", "b"})', () => {
    const src = `package x;
public class M {
  @Inject(method = {"a", "b"})
  public void onInject() {}
}`;
    expect(
      findAnno(extractJavaSymbols(src), 'Inject', 'method')?.parsed?.elementValuePairs.method,
    ).toEqual({
      kind: 'array',
      value: [
        { kind: 'string', value: 'a' },
        { kind: 'string', value: 'b' },
      ],
    });
  });
});
