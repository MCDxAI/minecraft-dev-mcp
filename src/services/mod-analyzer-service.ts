import { existsSync, statSync } from 'node:fs';
import AdmZip from 'adm-zip';
import type {
  DependencyType,
  ModAnalysisResult,
  ModClass,
  ModContact,
  ModDependency,
  ModEntrypoint,
  ModEnvironment,
  ModLoader,
  ModMixinConfig,
  ModPerson,
} from '../types/minecraft.js';
import { logger } from '../utils/logger.js';

/**
 * Options for mod analysis
 */
export interface ModAnalyzerOptions {
  /** Include all classes in output (can be large) */
  includeAllClasses?: boolean;
  /** Include raw metadata files */
  includeRawMetadata?: boolean;
  /** Analyze bytecode for mixin detection */
  analyzeBytecode?: boolean;
}

/**
 * Fabric mod.json structure
 */
interface FabricModJson {
  schemaVersion: number;
  id: string;
  version: string;
  name?: string;
  description?: string;
  authors?: Array<string | { name: string; contact?: Record<string, string> }>;
  contributors?: Array<string | { name: string; contact?: Record<string, string> }>;
  contact?: Record<string, string>;
  license?: string | string[];
  icon?: string;
  environment?: '*' | 'client' | 'server';
  entrypoints?: Record<string, Array<string | { adapter?: string; value: string }>>;
  mixins?: Array<string | { config: string; environment?: string }>;
  accessWidener?: string;
  depends?: Record<string, string | string[]>;
  recommends?: Record<string, string | string[]>;
  suggests?: Record<string, string | string[]>;
  breaks?: Record<string, string | string[]>;
  conflicts?: Record<string, string | string[]>;
  jars?: Array<{ file: string }>;
  languageAdapters?: Record<string, string>;
  custom?: Record<string, unknown>;
}

/**
 * Quilt mod.json structure (qmj)
 */
interface QuiltModJson {
  schema_version: number;
  quilt_loader: {
    group: string;
    id: string;
    version: string;
    metadata?: {
      name?: string;
      description?: string;
      contributors?: Record<string, string>;
      contact?: Record<string, string>;
      license?: string | string[];
      icon?: string;
    };
    entrypoints?: Record<string, Array<string | { adapter?: string; value: string }>>;
    depends?: Array<{
      id: string;
      versions?: string | string[];
      optional?: boolean;
      reason?: string;
    }>;
    breaks?: Array<{
      id: string;
      versions?: string | string[];
      reason?: string;
    }>;
    provides?: Array<{ id: string; version?: string }>;
    jars?: string[];
    load_type?: 'always' | 'if_possible' | 'if_required';
  };
  mixin?: string | string[];
  access_widener?: string;
  minecraft?: {
    environment?: '*' | 'client' | 'dedicated_server';
  };
}

/**
 * Mixin config JSON structure
 */
interface MixinConfigJson {
  required?: boolean;
  package?: string;
  compatibilityLevel?: string;
  mixins?: string[];
  client?: string[];
  server?: string[];
  injectors?: {
    defaultRequire?: number;
  };
  refmap?: string;
  minVersion?: string;
}

/**
 * Service for analyzing third-party mod JARs
 */
export class ModAnalyzerService {
  /**
   * Analyze a mod JAR file
   */
  async analyzeMod(jarPath: string, options: ModAnalyzerOptions = {}): Promise<ModAnalysisResult> {
    const startTime = Date.now();

    // Validate JAR exists
    if (!existsSync(jarPath)) {
      throw new Error(`JAR file not found: ${jarPath}`);
    }

    const jarStats = statSync(jarPath);
    if (!jarStats.isFile()) {
      throw new Error(`Path is not a file: ${jarPath}`);
    }

    logger.info(`Analyzing mod JAR: ${jarPath}`);

    const zip = new AdmZip(jarPath);
    const entries = zip.getEntries();

    // Detect mod loader and parse metadata
    const loaderInfo = this.detectModLoader(zip);
    const metadata = await this.parseMetadata(zip, loaderInfo.loader);

    // Parse mixin configs
    const mixinConfigs = this.parseMixinConfigs(zip, metadata.mixinConfigFiles);

    // Analyze classes
    const classAnalysis = await this.analyzeClasses(
      zip,
      entries,
      metadata.entrypointClasses,
      mixinConfigs,
      options,
    );

    const result: ModAnalysisResult = {
      analysis: {
        jarPath,
        jarSize: jarStats.size,
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
      loader: loaderInfo.loader,
      metadata: {
        id: metadata.id,
        version: metadata.version,
        name: metadata.name,
        description: metadata.description,
        authors: metadata.authors,
        contributors: metadata.contributors,
        license: metadata.license,
        icon: metadata.icon,
        contact: metadata.contact,
      },
      compatibility: {
        minecraft: metadata.minecraft,
        loaderVersion: metadata.loaderVersion,
        javaVersion: metadata.javaVersion,
        environment: metadata.environment,
      },
      dependencies: metadata.dependencies,
      entrypoints: metadata.entrypoints,
      mixins: mixinConfigs,
      accessWidener: metadata.accessWidener,
      classes: classAnalysis,
      nestedJars: metadata.nestedJars,
    };

    if (options.includeRawMetadata) {
      result.rawMetadata = {
        fabricModJson: loaderInfo.fabricModJson,
        quiltModJson: loaderInfo.quiltModJson,
        mixinConfigs: this.getRawMixinConfigs(zip, metadata.mixinConfigFiles),
      };
    }

    logger.info(
      `Mod analysis complete: ${metadata.id} v${metadata.version} (${loaderInfo.loader})`,
    );
    return result;
  }

  /**
   * Detect which mod loader the JAR is for
   */
  private detectModLoader(zip: AdmZip): {
    loader: ModLoader;
    fabricModJson?: FabricModJson;
    quiltModJson?: QuiltModJson;
  } {
    // Check for Fabric (fabric.mod.json)
    const fabricEntry = zip.getEntry('fabric.mod.json');
    if (fabricEntry) {
      try {
        const content = fabricEntry.getData().toString('utf8');
        const fabricModJson = JSON.parse(content) as FabricModJson;
        return { loader: 'fabric', fabricModJson };
      } catch (e) {
        logger.warn('Failed to parse fabric.mod.json', e);
      }
    }

    // Check for Quilt (quilt.mod.json)
    const quiltEntry = zip.getEntry('quilt.mod.json');
    if (quiltEntry) {
      try {
        const content = quiltEntry.getData().toString('utf8');
        const quiltModJson = JSON.parse(content) as QuiltModJson;
        return { loader: 'quilt', quiltModJson };
      } catch (e) {
        logger.warn('Failed to parse quilt.mod.json', e);
      }
    }

    // Check for Forge/NeoForge (META-INF/mods.toml or META-INF/neoforge.mods.toml)
    const neoforgeEntry = zip.getEntry('META-INF/neoforge.mods.toml');
    if (neoforgeEntry) {
      return { loader: 'neoforge' };
    }

    const forgeEntry = zip.getEntry('META-INF/mods.toml');
    if (forgeEntry) {
      return { loader: 'forge' };
    }

    // Legacy Forge (@Mod annotation check or mcmod.info)
    const mcmodEntry = zip.getEntry('mcmod.info');
    if (mcmodEntry) {
      return { loader: 'forge' };
    }

    return { loader: 'unknown' };
  }

  /**
   * Parse mod metadata based on loader type
   */
  private async parseMetadata(
    zip: AdmZip,
    loader: ModLoader,
  ): Promise<{
    id: string;
    version: string;
    name?: string;
    description?: string;
    authors: ModPerson[];
    contributors?: ModPerson[];
    license?: string | string[];
    icon?: string;
    contact?: ModContact;
    minecraft: string;
    loaderVersion?: string;
    javaVersion?: number;
    environment: ModEnvironment;
    dependencies: ModDependency[];
    entrypoints: ModEntrypoint[];
    mixinConfigFiles: string[];
    accessWidener?: string;
    nestedJars?: string[];
    entrypointClasses: string[];
  }> {
    switch (loader) {
      case 'fabric':
        return this.parseFabricMetadata(zip);
      case 'quilt':
        return this.parseQuiltMetadata(zip);
      case 'forge':
      case 'neoforge':
        return this.parseForgeMetadata(zip, loader);
      default:
        return this.createUnknownMetadata(zip);
    }
  }

  /**
   * Parse Fabric mod metadata
   */
  private parseFabricMetadata(zip: AdmZip): {
    id: string;
    version: string;
    name?: string;
    description?: string;
    authors: ModPerson[];
    contributors?: ModPerson[];
    license?: string | string[];
    icon?: string;
    contact?: ModContact;
    minecraft: string;
    loaderVersion?: string;
    javaVersion?: number;
    environment: ModEnvironment;
    dependencies: ModDependency[];
    entrypoints: ModEntrypoint[];
    mixinConfigFiles: string[];
    accessWidener?: string;
    nestedJars?: string[];
    entrypointClasses: string[];
  } {
    const entry = zip.getEntry('fabric.mod.json');
    if (!entry) {
      throw new Error('fabric.mod.json not found');
    }

    const content = entry.getData().toString('utf8');
    const mod = JSON.parse(content) as FabricModJson;

    // Parse authors
    const authors: ModPerson[] = (mod.authors ?? []).map((a) =>
      typeof a === 'string' ? { name: a } : { name: a.name, contact: a.contact as ModContact },
    );

    // Parse contributors
    const contributors: ModPerson[] = (mod.contributors ?? []).map((c) =>
      typeof c === 'string' ? { name: c } : { name: c.name, contact: c.contact as ModContact },
    );

    // Parse dependencies
    const dependencies: ModDependency[] = [];
    this.addFabricDependencies(dependencies, mod.depends, 'required');
    this.addFabricDependencies(dependencies, mod.recommends, 'optional');
    this.addFabricDependencies(dependencies, mod.suggests, 'suggests');
    this.addFabricDependencies(dependencies, mod.breaks, 'breaks');
    this.addFabricDependencies(dependencies, mod.conflicts, 'incompatible');

    // Parse entrypoints
    const entrypoints: ModEntrypoint[] = [];
    const entrypointClasses: string[] = [];
    if (mod.entrypoints) {
      for (const [type, eps] of Object.entries(mod.entrypoints)) {
        for (const ep of eps) {
          if (typeof ep === 'string') {
            entrypoints.push({ type, value: ep });
            entrypointClasses.push(this.extractClassName(ep));
          } else {
            entrypoints.push({ type, value: ep.value, adapter: ep.adapter });
            entrypointClasses.push(this.extractClassName(ep.value));
          }
        }
      }
    }

    // Parse mixin configs
    const mixinConfigFiles: string[] = [];
    if (mod.mixins) {
      for (const mixin of mod.mixins) {
        if (typeof mixin === 'string') {
          mixinConfigFiles.push(mixin);
        } else {
          mixinConfigFiles.push(mixin.config);
        }
      }
    }

    // Get Minecraft version from depends
    let minecraft = '*';
    const mcDep = dependencies.find((d) => d.modId === 'minecraft');
    if (mcDep) {
      minecraft = mcDep.versionRange;
    }

    // Get loader version from depends
    let loaderVersion: string | undefined;
    const loaderDep = dependencies.find((d) => d.modId === 'fabricloader');
    if (loaderDep) {
      loaderVersion = loaderDep.versionRange;
    }

    // Get java version from depends
    let javaVersion: number | undefined;
    const javaDep = dependencies.find((d) => d.modId === 'java');
    if (javaDep) {
      const match = javaDep.versionRange.match(/>=?(\d+)/);
      if (match) {
        javaVersion = Number.parseInt(match[1], 10);
      }
    }

    // Nested JARs
    const nestedJars = mod.jars?.map((j) => j.file);

    return {
      id: mod.id,
      version: mod.version,
      name: mod.name,
      description: mod.description,
      authors,
      contributors: contributors.length > 0 ? contributors : undefined,
      license: mod.license,
      icon: mod.icon,
      contact: mod.contact as ModContact,
      minecraft,
      loaderVersion,
      javaVersion,
      environment: (mod.environment ?? '*') as ModEnvironment,
      dependencies,
      entrypoints,
      mixinConfigFiles,
      accessWidener: mod.accessWidener,
      nestedJars,
      entrypointClasses,
    };
  }

  /**
   * Parse Quilt mod metadata
   */
  private parseQuiltMetadata(zip: AdmZip): {
    id: string;
    version: string;
    name?: string;
    description?: string;
    authors: ModPerson[];
    contributors?: ModPerson[];
    license?: string | string[];
    icon?: string;
    contact?: ModContact;
    minecraft: string;
    loaderVersion?: string;
    javaVersion?: number;
    environment: ModEnvironment;
    dependencies: ModDependency[];
    entrypoints: ModEntrypoint[];
    mixinConfigFiles: string[];
    accessWidener?: string;
    nestedJars?: string[];
    entrypointClasses: string[];
  } {
    const entry = zip.getEntry('quilt.mod.json');
    if (!entry) {
      throw new Error('quilt.mod.json not found');
    }

    const content = entry.getData().toString('utf8');
    const mod = JSON.parse(content) as QuiltModJson;
    const loader = mod.quilt_loader;
    const meta = loader.metadata ?? {};

    // Parse contributors
    const authors: ModPerson[] = [];
    if (meta.contributors) {
      for (const [name, role] of Object.entries(meta.contributors)) {
        authors.push({ name, contact: { homepage: role } });
      }
    }

    // Parse dependencies
    const dependencies: ModDependency[] = [];
    if (loader.depends) {
      for (const dep of loader.depends) {
        const versionRange = Array.isArray(dep.versions)
          ? dep.versions.join(' || ')
          : (dep.versions ?? '*');
        dependencies.push({
          modId: dep.id,
          versionRange,
          type: dep.optional ? 'optional' : 'required',
          mandatory: !dep.optional,
        });
      }
    }
    if (loader.breaks) {
      for (const dep of loader.breaks) {
        const versionRange = Array.isArray(dep.versions)
          ? dep.versions.join(' || ')
          : (dep.versions ?? '*');
        dependencies.push({
          modId: dep.id,
          versionRange,
          type: 'breaks',
          mandatory: false,
        });
      }
    }

    // Parse entrypoints
    const entrypoints: ModEntrypoint[] = [];
    const entrypointClasses: string[] = [];
    if (loader.entrypoints) {
      for (const [type, eps] of Object.entries(loader.entrypoints)) {
        for (const ep of eps) {
          if (typeof ep === 'string') {
            entrypoints.push({ type, value: ep });
            entrypointClasses.push(this.extractClassName(ep));
          } else {
            entrypoints.push({ type, value: ep.value, adapter: ep.adapter });
            entrypointClasses.push(this.extractClassName(ep.value));
          }
        }
      }
    }

    // Parse mixin configs
    const mixinConfigFiles: string[] = [];
    if (mod.mixin) {
      if (typeof mod.mixin === 'string') {
        mixinConfigFiles.push(mod.mixin);
      } else {
        mixinConfigFiles.push(...mod.mixin);
      }
    }

    // Get Minecraft version
    let minecraft = '*';
    const mcDep = dependencies.find((d) => d.modId === 'minecraft');
    if (mcDep) {
      minecraft = mcDep.versionRange;
    }

    // Get loader version
    let loaderVersion: string | undefined;
    const loaderDep = dependencies.find((d) => d.modId === 'quilt_loader');
    if (loaderDep) {
      loaderVersion = loaderDep.versionRange;
    }

    // Environment mapping
    let environment: ModEnvironment = '*';
    if (mod.minecraft?.environment === 'client') {
      environment = 'client';
    } else if (mod.minecraft?.environment === 'dedicated_server') {
      environment = 'server';
    }

    return {
      id: loader.id,
      version: loader.version,
      name: meta.name,
      description: meta.description,
      authors,
      license: meta.license,
      icon: meta.icon,
      contact: meta.contact as ModContact,
      minecraft,
      loaderVersion,
      javaVersion: undefined,
      environment,
      dependencies,
      entrypoints,
      mixinConfigFiles,
      accessWidener: mod.access_widener,
      nestedJars: loader.jars,
      entrypointClasses,
    };
  }

  /**
   * Parse Forge/NeoForge mod metadata (simplified TOML parsing)
   */
  private parseForgeMetadata(
    zip: AdmZip,
    loader: 'forge' | 'neoforge',
  ): {
    id: string;
    version: string;
    name?: string;
    description?: string;
    authors: ModPerson[];
    contributors?: ModPerson[];
    license?: string | string[];
    icon?: string;
    contact?: ModContact;
    minecraft: string;
    loaderVersion?: string;
    javaVersion?: number;
    environment: ModEnvironment;
    dependencies: ModDependency[];
    entrypoints: ModEntrypoint[];
    mixinConfigFiles: string[];
    accessWidener?: string;
    nestedJars?: string[];
    entrypointClasses: string[];
  } {
    const tomlPath = loader === 'neoforge' ? 'META-INF/neoforge.mods.toml' : 'META-INF/mods.toml';
    const entry = zip.getEntry(tomlPath);

    let id = 'unknown';
    let version = '0.0.0';
    let name: string | undefined;
    let description: string | undefined;
    let authors: ModPerson[] = [];
    let license: string | undefined;
    const dependencies: ModDependency[] = [];
    let minecraft = '*';
    let loaderVersion: string | undefined;

    if (entry) {
      const content = entry.getData().toString('utf8');

      // Simple TOML parsing for key fields
      const modIdMatch = content.match(/modId\s*=\s*"([^"]+)"/);
      if (modIdMatch) id = modIdMatch[1];

      const versionMatch = content.match(/version\s*=\s*"([^"]+)"/);
      if (versionMatch) version = versionMatch[1];

      const nameMatch = content.match(/displayName\s*=\s*"([^"]+)"/);
      if (nameMatch) name = nameMatch[1];

      const descMatch = content.match(/description\s*=\s*'''([^']+)'''/s);
      if (descMatch) description = descMatch[1].trim();

      const authorsMatch = content.match(/authors\s*=\s*"([^"]+)"/);
      if (authorsMatch) {
        authors = authorsMatch[1].split(',').map((a) => ({ name: a.trim() }));
      }

      const licenseMatch = content.match(/license\s*=\s*"([^"]+)"/);
      if (licenseMatch) license = licenseMatch[1];

      // Parse dependencies section
      const mcVersionMatch = content.match(
        /\[\[dependencies\.[^\]]+\]\][\s\S]*?modId\s*=\s*"minecraft"[\s\S]*?versionRange\s*=\s*"\[([^\]]+)\]"/,
      );
      if (mcVersionMatch) {
        minecraft = mcVersionMatch[1];
      }

      const loaderMatch = content.match(
        /\[\[dependencies\.[^\]]+\]\][\s\S]*?modId\s*=\s*"(forge|neoforge)"[\s\S]*?versionRange\s*=\s*"\[([^\]]+)\]"/,
      );
      if (loaderMatch) {
        loaderVersion = loaderMatch[2];
      }
    }

    // Check for mixin configs in META-INF
    const mixinConfigFiles: string[] = [];
    const mixinsEntry = zip.getEntry(`META-INF/${id}.mixins.json`);
    if (mixinsEntry) {
      mixinConfigFiles.push(`META-INF/${id}.mixins.json`);
    }

    // Also check root for common patterns
    for (const e of zip.getEntries()) {
      if (e.entryName.endsWith('.mixins.json') && !mixinConfigFiles.includes(e.entryName)) {
        mixinConfigFiles.push(e.entryName);
      }
    }

    return {
      id,
      version,
      name,
      description,
      authors,
      license,
      contact: undefined,
      minecraft,
      loaderVersion,
      javaVersion: undefined,
      environment: '*',
      dependencies,
      entrypoints: [],
      mixinConfigFiles,
      accessWidener: undefined,
      nestedJars: undefined,
      entrypointClasses: [],
    };
  }

  /**
   * Create metadata for unknown loader type
   */
  private createUnknownMetadata(_zip: AdmZip): {
    id: string;
    version: string;
    name?: string;
    description?: string;
    authors: ModPerson[];
    contributors?: ModPerson[];
    license?: string | string[];
    icon?: string;
    contact?: ModContact;
    minecraft: string;
    loaderVersion?: string;
    javaVersion?: number;
    environment: ModEnvironment;
    dependencies: ModDependency[];
    entrypoints: ModEntrypoint[];
    mixinConfigFiles: string[];
    accessWidener?: string;
    nestedJars?: string[];
    entrypointClasses: string[];
  } {
    // Unknown loader - return minimal metadata
    return {
      id: 'unknown',
      version: '0.0.0',
      authors: [],
      minecraft: '*',
      environment: '*',
      dependencies: [],
      entrypoints: [],
      mixinConfigFiles: [],
      entrypointClasses: [],
    };
  }

  /**
   * Add Fabric-style dependencies
   */
  private addFabricDependencies(
    deps: ModDependency[],
    source: Record<string, string | string[]> | undefined,
    type: DependencyType,
  ): void {
    if (!source) return;

    for (const [modId, versions] of Object.entries(source)) {
      const versionRange = Array.isArray(versions) ? versions.join(' || ') : versions;
      deps.push({
        modId,
        versionRange,
        type,
        mandatory: type === 'required',
      });
    }
  }

  /**
   * Extract class name from entrypoint value
   */
  private extractClassName(value: string): string {
    // Handle method references like "com.example.Mod::init"
    const methodSep = value.indexOf('::');
    if (methodSep !== -1) {
      return value.substring(0, methodSep);
    }
    return value;
  }

  /**
   * Parse mixin configuration files
   */
  private parseMixinConfigs(zip: AdmZip, configFiles: string[]): ModMixinConfig[] {
    const configs: ModMixinConfig[] = [];

    for (const configFile of configFiles) {
      const entry = zip.getEntry(configFile);
      if (!entry) {
        logger.warn(`Mixin config not found: ${configFile}`);
        continue;
      }

      try {
        const content = entry.getData().toString('utf8');
        const config = JSON.parse(content) as MixinConfigJson;

        configs.push({
          configFile,
          package: config.package,
          mixins: config.mixins,
          clientMixins: config.client,
          serverMixins: config.server,
        });
      } catch (e) {
        logger.warn(`Failed to parse mixin config: ${configFile}`, e);
      }
    }

    return configs;
  }

  /**
   * Get raw mixin config JSON
   */
  private getRawMixinConfigs(zip: AdmZip, configFiles: string[]): Record<string, unknown> {
    const configs: Record<string, unknown> = {};

    for (const configFile of configFiles) {
      const entry = zip.getEntry(configFile);
      if (!entry) continue;

      try {
        const content = entry.getData().toString('utf8');
        configs[configFile] = JSON.parse(content);
      } catch {
        // Skip invalid configs
      }
    }

    return configs;
  }

  /**
   * Analyze classes in the JAR
   */
  private async analyzeClasses(
    _zip: AdmZip,
    entries: AdmZip.IZipEntry[],
    entrypointClasses: string[],
    mixinConfigs: ModMixinConfig[],
    options: ModAnalyzerOptions,
  ): Promise<{
    total: number;
    packages: Record<string, number>;
    mixinClasses: ModClass[];
    entrypointClasses: string[];
    allClasses?: ModClass[];
  }> {
    const packages: Record<string, number> = {};
    const mixinClasses: ModClass[] = [];
    const allClasses: ModClass[] = [];

    // Get all mixin class names from configs
    const mixinClassNames = new Set<string>();
    for (const config of mixinConfigs) {
      const pkg = config.package ?? '';
      for (const mixin of config.mixins ?? []) {
        mixinClassNames.add(pkg ? `${pkg}.${mixin}` : mixin);
      }
      for (const mixin of config.clientMixins ?? []) {
        mixinClassNames.add(pkg ? `${pkg}.${mixin}` : mixin);
      }
      for (const mixin of config.serverMixins ?? []) {
        mixinClassNames.add(pkg ? `${pkg}.${mixin}` : mixin);
      }
    }

    let total = 0;

    for (const entry of entries) {
      if (!entry.entryName.endsWith('.class')) continue;
      if (entry.entryName.startsWith('META-INF/')) continue;

      total++;

      // Convert path to class name
      const className = entry.entryName.replace(/\//g, '.').replace(/\.class$/, '');

      // Get package
      const lastDot = className.lastIndexOf('.');
      const pkg = lastDot > 0 ? className.substring(0, lastDot) : '(default)';
      packages[pkg] = (packages[pkg] ?? 0) + 1;

      // Check if this is a known mixin class
      const isMixin = mixinClassNames.has(className);

      // Basic class info
      const classInfo: ModClass = {
        className,
        isMixin,
        isInterface: false,
        isAbstract: false,
        isEnum: false,
        interfaces: [],
        access: [],
        methodCount: 0,
        fieldCount: 0,
      };

      // Analyze bytecode for detailed info
      if (options.analyzeBytecode !== false) {
        try {
          const data = entry.getData();
          const bytecodeInfo = this.analyzeClassBytecode(data, className);
          Object.assign(classInfo, bytecodeInfo);
        } catch (e) {
          // Skip classes that can't be analyzed
          logger.debug(`Failed to analyze bytecode for ${className}: ${e}`);
        }
      }

      if (isMixin || classInfo.isMixin) {
        mixinClasses.push(classInfo);
      }

      if (options.includeAllClasses) {
        allClasses.push(classInfo);
      }
    }

    return {
      total,
      packages,
      mixinClasses,
      entrypointClasses,
      allClasses: options.includeAllClasses ? allClasses : undefined,
    };
  }

  /**
   * Analyze class bytecode for detailed information
   */
  private analyzeClassBytecode(data: Buffer, className: string): Partial<ModClass> {
    const result: Partial<ModClass> = {};

    // Basic class file validation
    if (data.length < 10) return result;

    // Check magic number (0xCAFEBABE)
    if (data.readUInt32BE(0) !== 0xcafebabe) return result;

    // Read class file structure (skip minor/major version)
    // const minorVersion = data.readUInt16BE(4);
    // const majorVersion = data.readUInt16BE(6);

    // Read constant pool count
    const constantPoolCount = data.readUInt16BE(8);

    // Parse constant pool to find annotations and class info
    let offset = 10;
    const constantPool: Array<{ tag: number; value?: string | number }> = [{ tag: 0 }]; // Index 0 is unused

    try {
      for (let i = 1; i < constantPoolCount; i++) {
        const tag = data.readUInt8(offset);
        offset++;

        switch (tag) {
          case 1: {
            // CONSTANT_Utf8
            const length = data.readUInt16BE(offset);
            offset += 2;
            const value = data.toString('utf8', offset, offset + length);
            constantPool.push({ tag, value });
            offset += length;
            break;
          }
          case 3: // CONSTANT_Integer
          case 4: // CONSTANT_Float
            constantPool.push({ tag });
            offset += 4;
            break;
          case 5: // CONSTANT_Long
          case 6: // CONSTANT_Double
            constantPool.push({ tag });
            constantPool.push({ tag: 0 }); // Long/Double take two slots
            i++;
            offset += 8;
            break;
          case 7: // CONSTANT_Class
          case 8: // CONSTANT_String
            constantPool.push({ tag, value: data.readUInt16BE(offset) });
            offset += 2;
            break;
          case 9: // CONSTANT_Fieldref
          case 10: // CONSTANT_Methodref
          case 11: // CONSTANT_InterfaceMethodref
          case 12: // CONSTANT_NameAndType
            constantPool.push({ tag });
            offset += 4;
            break;
          case 15: // CONSTANT_MethodHandle
            constantPool.push({ tag });
            offset += 3;
            break;
          case 16: // CONSTANT_MethodType
            constantPool.push({ tag });
            offset += 2;
            break;
          case 17: // CONSTANT_Dynamic
          case 18: // CONSTANT_InvokeDynamic
            constantPool.push({ tag });
            offset += 4;
            break;
          case 19: // CONSTANT_Module
          case 20: // CONSTANT_Package
            constantPool.push({ tag });
            offset += 2;
            break;
          default:
            // Unknown tag, stop parsing
            return result;
        }
      }

      // Read access flags
      const accessFlags = data.readUInt16BE(offset);
      offset += 2;

      result.isInterface = (accessFlags & 0x0200) !== 0;
      result.isAbstract = (accessFlags & 0x0400) !== 0;
      result.isEnum = (accessFlags & 0x4000) !== 0;

      // Parse access flags
      const access: string[] = [];
      if (accessFlags & 0x0001) access.push('public');
      if (accessFlags & 0x0010) access.push('final');
      if (accessFlags & 0x0020) access.push('super');
      if (accessFlags & 0x0200) access.push('interface');
      if (accessFlags & 0x0400) access.push('abstract');
      if (accessFlags & 0x1000) access.push('synthetic');
      if (accessFlags & 0x2000) access.push('annotation');
      if (accessFlags & 0x4000) access.push('enum');
      result.access = access;

      // Skip this class and super class
      offset += 4;

      // Read interfaces count
      const interfacesCount = data.readUInt16BE(offset);
      offset += 2;

      const interfaces: string[] = [];
      for (let i = 0; i < interfacesCount; i++) {
        const interfaceIndex = data.readUInt16BE(offset);
        offset += 2;
        const interfaceEntry = constantPool[interfaceIndex];
        if (interfaceEntry?.tag === 7 && typeof interfaceEntry.value === 'number') {
          const nameEntry = constantPool[interfaceEntry.value];
          if (nameEntry?.tag === 1 && typeof nameEntry.value === 'string') {
            interfaces.push(nameEntry.value.replace(/\//g, '.'));
          }
        }
      }
      result.interfaces = interfaces;

      // Read fields count
      const fieldsCount = data.readUInt16BE(offset);
      offset += 2;
      result.fieldCount = fieldsCount;

      // Skip fields (simplified - just count)
      for (let i = 0; i < fieldsCount; i++) {
        offset += 6; // access_flags, name_index, descriptor_index
        const attrCount = data.readUInt16BE(offset);
        offset += 2;
        for (let j = 0; j < attrCount; j++) {
          offset += 2; // attribute_name_index
          const attrLength = data.readUInt32BE(offset);
          offset += 4 + attrLength;
        }
      }

      // Read methods count
      const methodsCount = data.readUInt16BE(offset);
      result.methodCount = methodsCount;

      // Check constant pool for Mixin annotation
      for (const entry of constantPool) {
        if (entry.tag === 1 && typeof entry.value === 'string') {
          if (
            entry.value === 'Lorg/spongepowered/asm/mixin/Mixin;' ||
            entry.value.includes('org/spongepowered/asm/mixin/Mixin')
          ) {
            result.isMixin = true;
          }
        }
      }
    } catch (e) {
      // Bytecode parsing failed, return partial results
      logger.debug(`Bytecode parsing error for ${className}: ${e}`);
    }

    return result;
  }
}

// Singleton instance
let instance: ModAnalyzerService | null = null;

export function getModAnalyzerService(): ModAnalyzerService {
  if (!instance) {
    instance = new ModAnalyzerService();
  }
  return instance;
}
