package net.minecraft.advancements.critereon;
import java.util.Optional;
// Public enclosing class; nested records are package-private (as in vanilla).
public class StatePropertiesPredicate {
    public interface ValueMatcher {}
    record ExactMatcher(String value) implements ValueMatcher {}
    record PropertyMatcher(String name, ValueMatcher valueMatcher) {}
    record RangedMatcher(Optional<String> minValue, Optional<String> maxValue) implements ValueMatcher {}
}
