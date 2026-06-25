import { describe, expect, it } from 'vitest';
import { extractJavaSymbols } from '../../src/utils/java-symbols.js';

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
