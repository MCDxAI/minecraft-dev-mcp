/**
 * Documentation Integration Service
 *
 * Provides documentation from multiple sources for Minecraft classes and methods:
 * - Fabric Wiki
 * - Minecraft Wiki (for game concepts)
 * - Parchment parameter names and javadocs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentationEntry } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { getCacheDir } from '../utils/paths.js';

/**
 * Documentation cache entry
 */
interface DocCache {
  [key: string]: {
    entry: DocumentationEntry;
    cachedAt: number;
  };
}

/**
 * Known documentation mappings for common Minecraft classes
 */
const KNOWN_DOCS: Record<string, Partial<DocumentationEntry>> = {
  'net.minecraft.entity.Entity': {
    summary: 'Base class for all entities in Minecraft',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.entity.LivingEntity': {
    summary: 'Base class for all living entities (mobs, players)',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.entity.player.PlayerEntity': {
    summary: 'Represents a player in the game world',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.block.Block': {
    summary: 'Base class for all blocks in the world',
    url: 'https://fabricmc.net/wiki/tutorial:blocks',
  },
  'net.minecraft.block.BlockState': {
    summary: 'Immutable snapshot of a block with its properties',
    url: 'https://fabricmc.net/wiki/tutorial:blockstate',
  },
  'net.minecraft.item.Item': {
    summary: 'Base class for all items in the game',
    url: 'https://fabricmc.net/wiki/tutorial:items',
  },
  'net.minecraft.item.ItemStack': {
    summary: 'Represents a stack of items with count and NBT data',
    url: 'https://fabricmc.net/wiki/tutorial:items',
  },
  'net.minecraft.world.World': {
    summary: 'Represents a game world/dimension',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.server.world.ServerWorld': {
    summary: 'Server-side world implementation',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.client.world.ClientWorld': {
    summary: 'Client-side world implementation',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.nbt.NbtCompound': {
    summary: 'Named Binary Tag compound for data serialization',
    url: 'https://fabricmc.net/wiki/tutorial:nbt',
  },
  'net.minecraft.util.Identifier': {
    summary: 'Namespaced identifier (e.g., minecraft:stone)',
    url: 'https://fabricmc.net/wiki/tutorial:identifiers',
  },
  'net.minecraft.util.math.BlockPos': {
    summary: 'Immutable integer position in the world',
    url: 'https://fabricmc.net/wiki/tutorial:blockpos',
  },
  'net.minecraft.util.math.Vec3d': {
    summary: 'Double-precision 3D vector',
    url: 'https://fabricmc.net/wiki/tutorial:vectors',
  },
  'net.minecraft.text.Text': {
    summary: 'Rich text component for chat and UI',
    url: 'https://fabricmc.net/wiki/tutorial:text',
  },
  'net.minecraft.screen.ScreenHandler': {
    summary: 'Manages inventory screen logic (like container)',
    url: 'https://fabricmc.net/wiki/tutorial:screenhandler',
  },
  'net.minecraft.recipe.Recipe': {
    summary: 'Base interface for crafting recipes',
    url: 'https://fabricmc.net/wiki/tutorial:recipes',
  },
  'net.minecraft.registry.Registry': {
    summary: 'Game registry for blocks, items, entities, etc.',
    url: 'https://fabricmc.net/wiki/tutorial:registry',
  },
  'net.minecraft.sound.SoundEvent': {
    summary: 'Represents a sound that can be played',
    url: 'https://fabricmc.net/wiki/tutorial:sounds',
  },
  'net.minecraft.particle.ParticleEffect': {
    summary: 'Particle effect that can be spawned',
    url: 'https://fabricmc.net/wiki/tutorial:particles',
  },
};

/**
 * Fabric Wiki page mappings
 */
const FABRIC_WIKI_PAGES: Record<string, string> = {
  entity: 'https://fabricmc.net/wiki/tutorial:entity',
  block: 'https://fabricmc.net/wiki/tutorial:blocks',
  item: 'https://fabricmc.net/wiki/tutorial:items',
  world: 'https://fabricmc.net/wiki/tutorial:world',
  recipe: 'https://fabricmc.net/wiki/tutorial:recipes',
  mixin: 'https://fabricmc.net/wiki/tutorial:mixin_introduction',
  accesswidener: 'https://fabricmc.net/wiki/tutorial:accesswideners',
  registry: 'https://fabricmc.net/wiki/tutorial:registry',
  networking: 'https://fabricmc.net/wiki/tutorial:networking',
  commands: 'https://fabricmc.net/wiki/tutorial:commands',
  events: 'https://fabricmc.net/wiki/tutorial:events',
  rendering: 'https://fabricmc.net/wiki/tutorial:rendering',
  blockentity: 'https://fabricmc.net/wiki/tutorial:blockentity',
  screenhandler: 'https://fabricmc.net/wiki/tutorial:screenhandler',
  datagen: 'https://fabricmc.net/wiki/tutorial:datagen',
};

/**
 * Documentation Integration Service
 */
export class DocumentationService {
  private cache: DocCache = {};
  private cacheDir: string;
  private cacheFile: string;
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.cacheDir = join(getCacheDir(), 'docs');
    this.cacheFile = join(this.cacheDir, 'doc_cache.json');
    this.loadCache();
  }

  /**
   * Load cache from disk
   */
  private loadCache(): void {
    try {
      if (existsSync(this.cacheFile)) {
        const content = readFileSync(this.cacheFile, 'utf8');
        this.cache = JSON.parse(content);
      }
    } catch (error) {
      logger.warn('Failed to load documentation cache:', error);
      this.cache = {};
    }
  }

  /**
   * Save cache to disk
   */
  private saveCache(): void {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save documentation cache:', error);
    }
  }

  /**
   * Get documentation for a class
   */
  async getDocumentation(className: string): Promise<DocumentationEntry | null> {
    // Check cache
    const cached = this.cache[className];
    if (cached && Date.now() - cached.cachedAt < this.cacheTTL) {
      return cached.entry;
    }

    // Check known docs
    if (KNOWN_DOCS[className]) {
      const entry: DocumentationEntry = {
        name: className,
        source: 'fabric_wiki',
        summary: KNOWN_DOCS[className].summary || '',
        url: KNOWN_DOCS[className].url || '',
        ...KNOWN_DOCS[className],
      };

      this.cache[className] = { entry, cachedAt: Date.now() };
      this.saveCache();
      return entry;
    }

    // Try to infer documentation from class name
    const inferred = this.inferDocumentation(className);
    if (inferred) {
      this.cache[className] = { entry: inferred, cachedAt: Date.now() };
      this.saveCache();
      return inferred;
    }

    return null;
  }

  /**
   * Infer documentation based on class name patterns
   */
  private inferDocumentation(className: string): DocumentationEntry | null {
    const simpleName = className.split('.').pop() || className;

    // Entity classes
    if (className.includes('.entity.') || simpleName.endsWith('Entity')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.entity,
        summary: this.generateSummary(simpleName, 'entity'),
        seeAlso: ['net.minecraft.entity.Entity', 'net.minecraft.entity.LivingEntity'],
      };
    }

    // Block classes
    if (className.includes('.block.') || simpleName.endsWith('Block')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.block,
        summary: this.generateSummary(simpleName, 'block'),
        seeAlso: ['net.minecraft.block.Block', 'net.minecraft.block.BlockState'],
      };
    }

    // Item classes
    if (className.includes('.item.') || simpleName.endsWith('Item')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.item,
        summary: this.generateSummary(simpleName, 'item'),
        seeAlso: ['net.minecraft.item.Item', 'net.minecraft.item.ItemStack'],
      };
    }

    // Screen/GUI classes
    if (
      className.includes('.screen.') ||
      simpleName.endsWith('Screen') ||
      simpleName.endsWith('Handler')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.screenhandler,
        summary: this.generateSummary(simpleName, 'screen/GUI'),
        seeAlso: ['net.minecraft.screen.ScreenHandler'],
      };
    }

    // Recipe classes
    if (className.includes('.recipe.') || simpleName.endsWith('Recipe')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.recipe,
        summary: this.generateSummary(simpleName, 'recipe'),
        seeAlso: ['net.minecraft.recipe.Recipe'],
      };
    }

    // Network/packet classes
    if (
      className.includes('.network.') ||
      simpleName.endsWith('Packet') ||
      simpleName.endsWith('S2CPacket') ||
      simpleName.endsWith('C2SPacket')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.networking,
        summary: this.generateSummary(simpleName, 'networking'),
      };
    }

    // Command classes
    if (className.includes('.command.') || simpleName.endsWith('Command')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.commands,
        summary: this.generateSummary(simpleName, 'command'),
      };
    }

    // Render classes
    if (
      className.includes('.render.') ||
      simpleName.endsWith('Renderer') ||
      simpleName.endsWith('Model')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.rendering,
        summary: this.generateSummary(simpleName, 'rendering'),
      };
    }

    // Registry classes
    if (className.includes('.registry.') || simpleName.includes('Registry')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.registry,
        summary: this.generateSummary(simpleName, 'registry'),
        seeAlso: ['net.minecraft.registry.Registry'],
      };
    }

    // BlockEntity classes
    if (simpleName.endsWith('BlockEntity')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.blockentity,
        summary: this.generateSummary(simpleName, 'block entity'),
      };
    }

    return null;
  }

  /**
   * Generate a summary based on class name
   */
  private generateSummary(simpleName: string, category: string): string {
    // Convert CamelCase to words
    const words = simpleName.replace(/([A-Z])/g, ' $1').trim();
    return `${words} - a ${category} class`;
  }

  /**
   * Get documentation for a topic
   */
  async getTopicDocumentation(topic: string): Promise<DocumentationEntry | null> {
    const topicLower = topic.toLowerCase();

    // Check if it's a known topic
    if (FABRIC_WIKI_PAGES[topicLower]) {
      return {
        name: topic,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES[topicLower],
        summary: `Fabric Wiki documentation for ${topic}`,
      };
    }

    // Search for partial matches
    for (const [key, url] of Object.entries(FABRIC_WIKI_PAGES)) {
      if (key.includes(topicLower) || topicLower.includes(key)) {
        return {
          name: topic,
          source: 'fabric_wiki',
          url,
          summary: `Fabric Wiki documentation for ${key}`,
        };
      }
    }

    return null;
  }

  /**
   * Get all documentation URLs for a class and its context
   */
  async getRelatedDocumentation(className: string): Promise<DocumentationEntry[]> {
    const results: DocumentationEntry[] = [];

    // Get main documentation
    const main = await this.getDocumentation(className);
    if (main) {
      results.push(main);
    }

    // Get documentation for related classes
    if (main?.seeAlso) {
      for (const related of main.seeAlso) {
        const relatedDoc = await this.getDocumentation(related);
        if (relatedDoc && !results.some((r) => r.name === relatedDoc.name)) {
          results.push(relatedDoc);
        }
      }
    }

    // Infer related topics from package
    const packagePath = className.split('.').slice(0, -1).join('.');
    if (packagePath.includes('entity')) {
      const entityDoc = await this.getTopicDocumentation('entity');
      if (entityDoc && !results.some((r) => r.url === entityDoc.url)) {
        results.push(entityDoc);
      }
    }
    if (packagePath.includes('block')) {
      const blockDoc = await this.getTopicDocumentation('block');
      if (blockDoc && !results.some((r) => r.url === blockDoc.url)) {
        results.push(blockDoc);
      }
    }
    if (packagePath.includes('item')) {
      const itemDoc = await this.getTopicDocumentation('item');
      if (itemDoc && !results.some((r) => r.url === itemDoc.url)) {
        results.push(itemDoc);
      }
    }

    return results;
  }

  /**
   * Search for documentation across all known entries
   */
  searchDocumentation(query: string): DocumentationEntry[] {
    const results: DocumentationEntry[] = [];
    const queryLower = query.toLowerCase();

    // Search known docs
    for (const [className, partialEntry] of Object.entries(KNOWN_DOCS)) {
      if (
        className.toLowerCase().includes(queryLower) ||
        partialEntry.summary?.toLowerCase().includes(queryLower)
      ) {
        results.push({
          name: className,
          source: 'fabric_wiki',
          url: partialEntry.url || '',
          summary: partialEntry.summary || '',
        });
      }
    }

    // Search wiki pages
    for (const [topic, url] of Object.entries(FABRIC_WIKI_PAGES)) {
      if (topic.includes(queryLower)) {
        results.push({
          name: topic,
          source: 'fabric_wiki',
          url,
          summary: `Fabric Wiki: ${topic}`,
        });
      }
    }

    return results;
  }

  /**
   * Get Mixin documentation
   */
  getMixinDocumentation(): DocumentationEntry {
    return {
      name: 'Mixin',
      source: 'fabric_wiki',
      url: FABRIC_WIKI_PAGES.mixin,
      summary: 'Mixins allow mods to modify Minecraft classes at runtime',
      description: `
Mixins are a way to modify Minecraft's code without directly editing it.
Common injection types:
- @Inject: Add code at specific points
- @Redirect: Replace method calls
- @ModifyArg: Modify method arguments
- @ModifyVariable: Modify local variables
- @Shadow: Access private fields/methods
- @Accessor/@Invoker: Create getters/setters for private members
      `.trim(),
      seeAlso: ['SpongePowered Mixin', 'Access Wideners'],
    };
  }

  /**
   * Get Access Widener documentation
   */
  getAccessWidenerDocumentation(): DocumentationEntry {
    return {
      name: 'Access Widener',
      source: 'fabric_wiki',
      url: FABRIC_WIKI_PAGES.accesswidener,
      summary: 'Access Wideners change the access level of classes, methods, and fields',
      description: `
Access Wideners allow mods to:
- accessible: Make private/protected members public
- extendable: Make final classes non-final
- mutable: Make final fields non-final

Format:
accessWidener v2 named
accessible class net/minecraft/example/PrivateClass
accessible method net/minecraft/example/Class methodName (Lsome/Descriptor;)V
accessible field net/minecraft/example/Class fieldName Lsome/Type;
      `.trim(),
    };
  }

  /**
   * Clear the documentation cache
   */
  clearCache(): void {
    this.cache = {};
    this.saveCache();
  }
}

// Singleton instance
let documentationServiceInstance: DocumentationService | undefined;

export function getDocumentationService(): DocumentationService {
  if (!documentationServiceInstance) {
    documentationServiceInstance = new DocumentationService();
  }
  return documentationServiceInstance;
}
