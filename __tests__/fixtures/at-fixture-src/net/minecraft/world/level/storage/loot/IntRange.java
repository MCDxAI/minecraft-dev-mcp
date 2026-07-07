package net.minecraft.world.level.storage.loot;
import net.minecraft.world.level.storage.loot.providers.number.NumberProvider;
// Plain class (NOT a record). Private constructor + private fields (matches
// real 1.21.1: min/max are private, the (NumberProvider, NumberProvider) ctor is private).
public class IntRange {
    private final NumberProvider min;
    private final NumberProvider max;
    private IntRange(NumberProvider min, NumberProvider max) { this.min = min; this.max = max; }
}
