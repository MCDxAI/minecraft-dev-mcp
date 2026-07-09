package net.minecraft.advancements.critereon;
// Public enclosing class so the inner-class accessibility check passes.
public class LocationPredicate {
    // Package-private nested record: implicit canonical constructor + accessors
    // exist in bytecode but never appear in decompiled source. Reproduces
    // net.minecraft.advancements.critereon.LocationPredicate$PositionPredicate.
    record PositionPredicate(MinMaxBounds.Doubles x, MinMaxBounds.Doubles y, MinMaxBounds.Doubles z) {}
}
