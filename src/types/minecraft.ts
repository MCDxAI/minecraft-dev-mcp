/**
 * Minecraft version metadata from version_manifest_v2.json
 */
export interface VersionManifest {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionInfo[];
}

export interface VersionInfo {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel: number;
}

/**
 * Version-specific JSON (from version URL)
 */
export interface VersionJson {
  id: string;
  type: string;
  time: string;
  releaseTime: string;
  mainClass: string;
  downloads: {
    client?: Download;
    client_mappings?: Download;
    server?: Download;
    server_mappings?: Download;
  };
  libraries: Library[];
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
}

export interface Download {
  sha1: string;
  size: number;
  url: string;
}

export interface Library {
  name: string;
  downloads: {
    artifact?: {
      path: string;
      sha1: string;
      size: number;
      url: string;
    };
  };
}

/**
 * Mapping types
 */
export type MappingType = 'yarn' | 'mojmap' | 'intermediary';

/**
 * Tiny mapping entry (simplified)
 */
export interface TinyClass {
  intermediary: string;
  named: string;
  fields: TinyField[];
  methods: TinyMethod[];
}

export interface TinyField {
  intermediary: string;
  named: string;
  descriptor: string;
}

export interface TinyMethod {
  intermediary: string;
  named: string;
  descriptor: string;
}

/**
 * Registry data types
 */
export interface RegistryData {
  [registryType: string]: {
    [entryId: string]: RegistryEntry;
  };
}

export interface RegistryEntry {
  protocol_id?: number;
  [key: string]: unknown;
}

/**
 * Phase 2 Types - Mixin Analysis
 */

/** Mixin annotation types */
export type MixinInjectionType =
  | 'inject'
  | 'redirect'
  | 'modify_arg'
  | 'modify_variable'
  | 'modify_constant'
  | 'modify_return_value'
  | 'wrap_operation'
  | 'wrap_method';

/** Parsed Mixin class information */
export interface MixinClass {
  /** Mixin class name (fully qualified) */
  className: string;
  /** Target classes from @Mixin annotation */
  targets: string[];
  /** Priority from @Mixin annotation */
  priority: number;
  /** Injection points */
  injections: MixinInjection[];
  /** Shadow fields */
  shadows: MixinShadow[];
  /** Accessor methods */
  accessors: MixinAccessor[];
  /** Source file path */
  sourcePath?: string;
}

/** Mixin injection point */
export interface MixinInjection {
  /** Type of injection (@Inject, @Redirect, etc.) */
  type: MixinInjectionType;
  /** Method name in mixin */
  methodName: string;
  /** Target method (from @At or method parameter) */
  targetMethod: string;
  /** Injection point (HEAD, RETURN, INVOKE, etc.) */
  at?: string;
  /** Target value for @At (method reference) */
  atTarget?: string;
  /** Is cancellable? */
  cancellable?: boolean;
  /** Line number in source */
  line: number;
  /** Raw annotation text */
  rawAnnotation: string;
}

/** Shadow field/method */
export interface MixinShadow {
  /** Field or method name */
  name: string;
  /** Type descriptor */
  type: string;
  /** Is method (vs field) */
  isMethod: boolean;
  /** Line number */
  line: number;
}

/** Accessor/Invoker method */
export interface MixinAccessor {
  /** Accessor method name */
  name: string;
  /** Target field/method */
  target: string;
  /** Is invoker (vs accessor) */
  isInvoker: boolean;
  /** Line number */
  line: number;
}

/** Mixin validation result */
export interface MixinValidationResult {
  /** Mixin class being validated */
  mixin: MixinClass;
  /** Is valid overall */
  isValid: boolean;
  /** Validation errors */
  errors: MixinValidationError[];
  /** Validation warnings */
  warnings: MixinValidationWarning[];
  /** Suggested fixes */
  suggestions: MixinSuggestion[];
}

/** Validation error */
export interface MixinValidationError {
  /** Error type */
  type:
    | 'target_not_found'
    | 'method_not_found'
    | 'signature_mismatch'
    | 'injection_point_invalid'
    | 'shadow_not_found';
  /** Error message */
  message: string;
  /** Related mixin element */
  element?: MixinInjection | MixinShadow | MixinAccessor;
  /** Line number */
  line?: number;
}

/** Validation warning */
export interface MixinValidationWarning {
  /** Warning type */
  type: 'deprecated_target' | 'fragile_injection' | 'performance' | 'compatibility';
  /** Warning message */
  message: string;
  /** Related element */
  element?: MixinInjection | MixinShadow | MixinAccessor;
  /** Line number */
  line?: number;
}

/** Suggested fix for mixin issues */
export interface MixinSuggestion {
  /** Suggestion type */
  type: 'fix_target' | 'fix_method' | 'fix_signature' | 'use_alternative' | 'add_compatibility';
  /** Description */
  message: string;
  /** Code suggestion (replacement text) */
  suggestedCode?: string;
  /** Related element */
  element?: MixinInjection | MixinShadow | MixinAccessor;
  /** Line number to apply fix */
  line?: number;
}

/**
 * Phase 2 Types - Access Widener
 */

/** Access widener entry type */
export type AccessWidenerType = 'accessible' | 'extendable' | 'mutable';

/** Access widener target type */
export type AccessWidenerTarget = 'class' | 'method' | 'field';

/** Parsed access widener file */
export interface AccessWidener {
  /** Namespace (usually 'named' or 'intermediary') */
  namespace: string;
  /** Version of access widener format */
  version: number;
  /** Access widener entries */
  entries: AccessWidenerEntry[];
  /** Source file path */
  sourcePath?: string;
}

/** Single access widener entry */
export interface AccessWidenerEntry {
  /** Access type (accessible, extendable, mutable) */
  accessType: AccessWidenerType;
  /** Target type (class, method, field) */
  targetType: AccessWidenerTarget;
  /** Class name (always present) */
  className: string;
  /** Member name (for method/field) */
  memberName?: string;
  /** Member descriptor (for method/field) */
  memberDescriptor?: string;
  /** Line number in source */
  line: number;
}

/** Access widener validation result */
export interface AccessWidenerValidation {
  /** Is valid */
  isValid: boolean;
  /** Validation errors */
  errors: Array<{
    entry: AccessWidenerEntry;
    message: string;
    suggestion?: string;
  }>;
  /** Warnings */
  warnings: Array<{
    entry: AccessWidenerEntry;
    message: string;
  }>;
}

/**
 * Phase 2 Types - AST Diffing
 */

/** Method signature for diffing */
export interface MethodSignature {
  /** Method name */
  name: string;
  /** Return type */
  returnType: string;
  /** Parameter types */
  parameters: string[];
  /** Modifiers (public, static, etc.) */
  modifiers: string[];
  /** Throws declarations */
  throws: string[];
  /** Generic type parameters */
  typeParameters?: string[];
}

/** Field signature for diffing */
export interface FieldSignature {
  /** Field name */
  name: string;
  /** Field type */
  type: string;
  /** Modifiers */
  modifiers: string[];
  /** Initial value (if constant) */
  constantValue?: string;
}

/** Class signature for diffing */
export interface ClassSignature {
  /** Fully qualified class name */
  name: string;
  /** Package name */
  package: string;
  /** Simple class name */
  simpleName: string;
  /** Is interface */
  isInterface: boolean;
  /** Is enum */
  isEnum: boolean;
  /** Is abstract */
  isAbstract: boolean;
  /** Superclass */
  superclass?: string;
  /** Implemented interfaces */
  interfaces: string[];
  /** Methods */
  methods: MethodSignature[];
  /** Fields */
  fields: FieldSignature[];
  /** Inner classes */
  innerClasses: string[];
}

/** Detailed version diff result */
export interface DetailedVersionDiff {
  /** Source version */
  fromVersion: string;
  /** Target version */
  toVersion: string;
  /** Mapping type used */
  mapping: string;
  /** Added classes */
  addedClasses: ClassSignature[];
  /** Removed classes */
  removedClasses: ClassSignature[];
  /** Modified classes */
  modifiedClasses: ClassModification[];
  /** Summary statistics */
  summary: {
    classesAdded: number;
    classesRemoved: number;
    classesModified: number;
    methodsAdded: number;
    methodsRemoved: number;
    methodsModified: number;
    fieldsAdded: number;
    fieldsRemoved: number;
  };
}

/** Class modification details */
export interface ClassModification {
  /** Class name */
  className: string;
  /** Added methods */
  addedMethods: MethodSignature[];
  /** Removed methods */
  removedMethods: MethodSignature[];
  /** Modified methods (signature changed) */
  modifiedMethods: Array<{
    old: MethodSignature;
    new: MethodSignature;
    changes: string[];
  }>;
  /** Added fields */
  addedFields: FieldSignature[];
  /** Removed fields */
  removedFields: FieldSignature[];
  /** Changed superclass */
  superclassChange?: {
    old: string | undefined;
    new: string | undefined;
  };
  /** Changed interfaces */
  interfaceChanges?: {
    added: string[];
    removed: string[];
  };
}

/**
 * Phase 2 Types - Search Index
 */

/** Search index entry */
export interface SearchIndexEntry {
  /** Class name (fully qualified) */
  className: string;
  /** File path relative to decompiled dir */
  filePath: string;
  /** Line number */
  line: number;
  /** Type of entry (class, method, field, content) */
  entryType: 'class' | 'method' | 'field' | 'content';
  /** Symbol name (method/field name, or keyword for content) */
  symbol: string;
  /** Context (surrounding code) */
  context: string;
  /** Minecraft version */
  version: string;
  /** Mapping type */
  mapping: string;
}

/** Search result with ranking */
export interface RankedSearchResult extends SearchIndexEntry {
  /** Relevance score */
  score: number;
  /** Highlighted match context */
  highlightedContext?: string;
}

/**
 * Phase 2 Types - Documentation
 */

/** Documentation source */
export type DocSource = 'fabric_wiki' | 'minecraft_wiki' | 'javadoc' | 'parchment';

/** Documentation entry */
export interface DocumentationEntry {
  /** Class or method name */
  name: string;
  /** Source of documentation */
  source: DocSource;
  /** Documentation URL */
  url: string;
  /** Summary/description */
  summary: string;
  /** Full description (if available) */
  description?: string;
  /** Parameters (for methods) */
  parameters?: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  /** Return type description (for methods) */
  returns?: string;
  /** Related classes/methods */
  seeAlso?: string[];
  /** Last updated timestamp */
  lastUpdated?: string;
}

/**
 * Phase 3 Types - Mod Analysis
 */

/** Supported mod loaders */
export type ModLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown';

/** Mod environment (client/server/both) */
export type ModEnvironment = 'client' | 'server' | '*';

/** Mod dependency type */
export type DependencyType = 'required' | 'optional' | 'incompatible' | 'suggests' | 'breaks';

/** Mod dependency */
export interface ModDependency {
  /** Mod ID */
  modId: string;
  /** Version constraint (e.g., ">=1.0.0", "*") */
  versionRange: string;
  /** Dependency type */
  type: DependencyType;
  /** Is mandatory */
  mandatory: boolean;
}

/** Mod entrypoint */
export interface ModEntrypoint {
  /** Entrypoint type (main, client, server, preLaunch, etc.) */
  type: string;
  /** Class or method reference */
  value: string;
  /** Adapter (default: "default") */
  adapter?: string;
}

/** Mod contact information */
export interface ModContact {
  homepage?: string;
  issues?: string;
  sources?: string;
  email?: string;
  irc?: string;
  discord?: string;
}

/** Mod person (author/contributor) */
export interface ModPerson {
  name: string;
  contact?: ModContact;
}

/** Mixin configuration */
export interface ModMixinConfig {
  /** Mixin config file path */
  configFile: string;
  /** Environment (client/server/common) */
  environment?: ModEnvironment;
  /** Mixin package */
  package?: string;
  /** Mixin classes listed in config */
  mixins?: string[];
  /** Client-only mixins */
  clientMixins?: string[];
  /** Server-only mixins */
  serverMixins?: string[];
}

/** Analyzed class from mod JAR */
export interface ModClass {
  /** Fully qualified class name */
  className: string;
  /** Is mixin class (has @Mixin annotation) */
  isMixin: boolean;
  /** Mixin targets (if isMixin) */
  mixinTargets?: string[];
  /** Is interface */
  isInterface: boolean;
  /** Is abstract */
  isAbstract: boolean;
  /** Is enum */
  isEnum: boolean;
  /** Superclass */
  superclass?: string;
  /** Implemented interfaces */
  interfaces: string[];
  /** Access flags */
  access: string[];
  /** Method count */
  methodCount: number;
  /** Field count */
  fieldCount: number;
}

/** Complete mod analysis result */
export interface ModAnalysisResult {
  /** Analysis metadata */
  analysis: {
    /** JAR file path */
    jarPath: string;
    /** JAR file size in bytes */
    jarSize: number;
    /** Analysis timestamp */
    analyzedAt: string;
    /** Analysis duration in ms */
    durationMs: number;
  };

  /** Detected mod loader */
  loader: ModLoader;

  /** Mod metadata */
  metadata: {
    /** Mod ID */
    id: string;
    /** Mod version */
    version: string;
    /** Display name */
    name?: string;
    /** Description */
    description?: string;
    /** Authors */
    authors: ModPerson[];
    /** Contributors */
    contributors?: ModPerson[];
    /** License */
    license?: string | string[];
    /** Icon path in JAR */
    icon?: string;
    /** Contact information */
    contact?: ModContact;
  };

  /** Version compatibility */
  compatibility: {
    /** Minecraft version(s) */
    minecraft: string;
    /** Loader version requirement */
    loaderVersion?: string;
    /** Java version requirement */
    javaVersion?: number;
    /** Environment (client/server/*) */
    environment: ModEnvironment;
  };

  /** Dependencies */
  dependencies: ModDependency[];

  /** Entry points */
  entrypoints: ModEntrypoint[];

  /** Mixin configuration */
  mixins: ModMixinConfig[];

  /** Access widener file (Fabric) */
  accessWidener?: string;

  /** Class analysis */
  classes: {
    /** Total class count */
    total: number;
    /** Package breakdown */
    packages: Record<string, number>;
    /** Mixin classes */
    mixinClasses: ModClass[];
    /** Entry point classes */
    entrypointClasses: string[];
    /** All classes (if includeAllClasses option set) */
    allClasses?: ModClass[];
  };

  /** Nested JARs (Fabric JiJ) */
  nestedJars?: string[];

  /** Raw metadata files for reference */
  rawMetadata?: {
    fabricModJson?: unknown;
    quiltModJson?: unknown;
    modsToml?: unknown;
    mixinConfigs?: Record<string, unknown>;
  };
}
