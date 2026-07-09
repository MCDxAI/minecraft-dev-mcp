package net.minecraft.world.level.storage.loot.predicates;
import com.mojang.serialization.Codec;
import java.util.List;
import java.util.function.Function;
public abstract class CompositeLootItemCondition implements LootItemCondition {
    protected final List<LootItemCondition> terms;
    protected CompositeLootItemCondition(List<LootItemCondition> terms) { this.terms = terms; }
    protected static <T extends CompositeLootItemCondition> Codec<T> createInlineCodec(
            Function<List<LootItemCondition>, T> factory) {
        return null;
    }
}
