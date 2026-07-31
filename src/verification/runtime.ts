import type { JsonObject } from './hash.js';
import type { ExactEnvironment } from './schema.js';

export interface RuntimeBlock {
  name: string;
  attributes: JsonObject;
  innerBlocks: RuntimeBlock[];
}

export interface SaveRuntimeResult {
  markup: string;
}

export interface ParseRuntimeResult {
  blocks: RuntimeBlock[];
}

export interface ValidateRuntimeResult {
  valid: boolean;
  diagnostics: string[];
}

export interface DeprecatedMigrationRuntimeResult {
  matchedDeprecation: string | null;
  block: RuntimeBlock | null;
}

export interface ServerRenderRuntimeResult {
  executed: boolean;
  html: string;
}

export interface MarkupVerificationRuntime {
  getEnvironment(): Promise<ExactEnvironment> | ExactEnvironment;
  save(block: RuntimeBlock): Promise<SaveRuntimeResult>;
  parse(markup: string): Promise<ParseRuntimeResult>;
  validate(
    block: RuntimeBlock,
    markup: string,
    parsed: ParseRuntimeResult,
  ): Promise<ValidateRuntimeResult>;
  migrateDeprecated(
    blockName: string,
    fixtureMarkup: string,
  ): Promise<DeprecatedMigrationRuntimeResult>;
  renderDynamic(
    block: RuntimeBlock,
    context: JsonObject,
  ): Promise<ServerRenderRuntimeResult>;
}

export interface StaticSaveVerificationRequest {
  block: RuntimeBlock;
  expectedEnvironment: ExactEnvironment;
  expectedOutputHash?: string;
}

export interface DeprecatedFixtureVerificationRequest {
  blockName: string;
  fixtureMarkup: string;
  expectedEnvironment: ExactEnvironment;
  expectedOutputHash?: string;
}

export interface DynamicServerRenderVerificationRequest {
  block: RuntimeBlock;
  context: JsonObject;
  expectedEnvironment: ExactEnvironment;
  expectedOutputHash?: string;
}
