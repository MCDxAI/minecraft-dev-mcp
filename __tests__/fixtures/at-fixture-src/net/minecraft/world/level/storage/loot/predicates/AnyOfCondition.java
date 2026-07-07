package net.minecraft.world.level.storage.loot.predicates;
import java.util.List;
public class AnyOfCondition extends CompositeLootItemCondition {
    // Package-private constructor (as in vanilla). A constructor is NEVER
    // overridable, so widening it must not produce an "overridable" warning.
    AnyOfCondition(List<LootItemCondition> terms) { super(terms); }
}
