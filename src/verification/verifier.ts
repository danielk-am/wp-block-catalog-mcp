import { hashCanonical, hashText } from './hash.js';
import type {
  DeprecatedFixtureVerificationRequest,
  DynamicServerRenderVerificationRequest,
  MarkupVerificationRuntime,
  RuntimeBlock,
  StaticSaveVerificationRequest,
} from './runtime.js';
import {
  ExactEnvironmentSchema,
  hashExactEnvironment,
  sealEvidence,
  type ExactEnvironment,
  type RuntimeVerificationLabel,
  type VerificationEvidence,
  type VerificationEvidencePayload,
  type VerificationKind,
  type VerificationStageName,
} from './schema.js';

type EvidenceStage = VerificationEvidencePayload['stages'][number];
type EvidenceFailure = NonNullable<VerificationEvidencePayload['failure']>;

interface ExecutionState {
  kind: VerificationKind;
  blockName: string;
  expectedEnvironment: ExactEnvironment;
  expectedEnvironmentHash: string;
  observedEnvironmentBefore: ExactEnvironment | null;
  observedEnvironmentAfter: ExactEnvironment | null;
  inputHash: string;
  outputHash: string | null;
  stages: EvidenceStage[];
  activeStage: VerificationStageName;
}

interface FinalizeOptions {
  status: VerificationEvidencePayload['status'];
  label?: RuntimeVerificationLabel;
  failure?: EvidenceFailure;
}

class VerificationExecutionError extends Error {
  constructor(
    readonly stage: VerificationStageName,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertBlockName(
  block: RuntimeBlock,
  expected: string,
  stage: VerificationStageName,
): void {
  if (block.name !== expected) {
    throw new VerificationExecutionError(
      stage,
      'parsed-block-mismatch',
      `Parsed root block "${block.name}" does not match "${expected}"`,
    );
  }
}

function addStage(
  state: ExecutionState,
  name: VerificationStageName,
  status: EvidenceStage['status'],
  inputHash: string,
  outputHash: string | null,
  details: EvidenceStage['details'] = {},
): void {
  state.stages.push({
    name,
    status,
    inputHash,
    outputHash,
    details,
  });
}

function finalize(
  state: ExecutionState,
  options: FinalizeOptions,
): VerificationEvidence {
  return sealEvidence({
    schemaVersion: 1,
    kind: state.kind,
    blockName: state.blockName,
    status: options.status,
    labelsGranted: options.label === undefined ? [] : [ options.label ],
    expectedEnvironment: state.expectedEnvironment,
    expectedEnvironmentHash: state.expectedEnvironmentHash,
    observedEnvironmentBefore: state.observedEnvironmentBefore,
    observedEnvironmentAfter: state.observedEnvironmentAfter,
    inputHash: state.inputHash,
    outputHash: state.outputHash,
    stages: state.stages,
    failure: options.failure ?? null,
  });
}

function fail(
  state: ExecutionState,
  status: 'drift' | 'failed',
  stage: VerificationStageName,
  code: string,
  message: string,
): VerificationEvidence {
  return finalize(state, {
    status,
    failure: { stage, code, message },
  });
}

export class MarkupVerifier {
  constructor(private readonly runtime: MarkupVerificationRuntime) {}

  async verifyStaticSave(
    request: StaticSaveVerificationRequest,
  ): Promise<VerificationEvidence> {
    const state = this.createState(
      'static-save',
      request.block.name,
      request.expectedEnvironment,
      hashCanonical(request.block),
    );
    const environmentFailure = await this.checkInitialEnvironment(state);
    if (environmentFailure) {
      return environmentFailure;
    }

    try {
      state.activeStage = 'save';
      const saved = await this.runtime.save(request.block);
      if (typeof saved.markup !== 'string') {
        throw new VerificationExecutionError(
          'save',
          'invalid-save-result',
          'Runtime save result did not contain markup',
        );
      }
      state.outputHash = hashText(saved.markup);
      addStage(
        state,
        'save',
        'success',
        state.inputHash,
        state.outputHash,
      );

      state.activeStage = 'parse';
      const parsed = await this.runtime.parse(saved.markup);
      const parsedHash = hashCanonical(parsed);
      const root = parsed.blocks[0];
      if (!root) {
        addStage(
          state,
          'parse',
          'failed',
          state.outputHash,
          parsedHash,
        );
        throw new VerificationExecutionError(
          'parse',
          'empty-parse-result',
          'Runtime parser returned no root block',
        );
      }
      assertBlockName(root, request.block.name, 'parse');
      addStage(
        state,
        'parse',
        'success',
        state.outputHash,
        parsedHash,
        { rootBlock: root.name },
      );

      state.activeStage = 'validate';
      const validated = await this.runtime.validate(
        request.block,
        saved.markup,
        parsed,
      );
      const validationHash = hashCanonical(validated);
      addStage(
        state,
        'validate',
        validated.valid ? 'success' : 'failed',
        parsedHash,
        validationHash,
        { diagnostics: validated.diagnostics },
      );
      if (!validated.valid) {
        throw new VerificationExecutionError(
          'validate',
          'runtime-validation-failed',
          validated.diagnostics.join('; ') ||
            'Runtime rejected its saved markup',
        );
      }

      return await this.finishSuccessfulExecution(
        state,
        request.expectedOutputHash,
        'save-runtime-valid',
      );
    } catch (error) {
      return await this.finishFailedExecution(state, error);
    }
  }

  async verifyDeprecatedFixture(
    request: DeprecatedFixtureVerificationRequest,
  ): Promise<VerificationEvidence> {
    const state = this.createState(
      'deprecated-fixture',
      request.blockName,
      request.expectedEnvironment,
      hashText(request.fixtureMarkup),
    );
    const environmentFailure = await this.checkInitialEnvironment(state);
    if (environmentFailure) {
      return environmentFailure;
    }

    try {
      state.activeStage = 'migrate';
      const migrated = await this.runtime.migrateDeprecated(
        request.blockName,
        request.fixtureMarkup,
      );
      const migrationHash = hashCanonical(migrated);
      if (!migrated.matchedDeprecation || !migrated.block) {
        addStage(
          state,
          'migrate',
          'failed',
          state.inputHash,
          migrationHash,
        );
        throw new VerificationExecutionError(
          'migrate',
          'deprecation-not-matched',
          'Exact runtime did not match a deprecation for the fixture',
        );
      }
      assertBlockName(migrated.block, request.blockName, 'migrate');
      addStage(
        state,
        'migrate',
        'success',
        state.inputHash,
        migrationHash,
        { matchedDeprecation: migrated.matchedDeprecation },
      );

      state.activeStage = 'save';
      const saved = await this.runtime.save(migrated.block);
      if (typeof saved.markup !== 'string') {
        throw new VerificationExecutionError(
          'save',
          'invalid-save-result',
          'Runtime save result did not contain migrated markup',
        );
      }
      state.outputHash = hashText(saved.markup);
      addStage(
        state,
        'save',
        'success',
        migrationHash,
        state.outputHash,
      );

      state.activeStage = 'parse';
      const parsed = await this.runtime.parse(saved.markup);
      const parsedHash = hashCanonical(parsed);
      const root = parsed.blocks[0];
      if (!root) {
        addStage(
          state,
          'parse',
          'failed',
          state.outputHash,
          parsedHash,
        );
        throw new VerificationExecutionError(
          'parse',
          'empty-parse-result',
          'Runtime parser returned no migrated root block',
        );
      }
      assertBlockName(root, request.blockName, 'parse');
      addStage(
        state,
        'parse',
        'success',
        state.outputHash,
        parsedHash,
        { rootBlock: root.name },
      );

      state.activeStage = 'validate';
      const validated = await this.runtime.validate(
        migrated.block,
        saved.markup,
        parsed,
      );
      const validationHash = hashCanonical(validated);
      addStage(
        state,
        'validate',
        validated.valid ? 'success' : 'failed',
        parsedHash,
        validationHash,
        { diagnostics: validated.diagnostics },
      );
      if (!validated.valid) {
        throw new VerificationExecutionError(
          'validate',
          'runtime-validation-failed',
          validated.diagnostics.join('; ') ||
            'Runtime rejected migrated markup',
        );
      }

      return await this.finishSuccessfulExecution(
        state,
        request.expectedOutputHash,
        'deprecated-fixture-valid',
      );
    } catch (error) {
      return await this.finishFailedExecution(state, error);
    }
  }

  async verifyDynamicServerRender(
    request: DynamicServerRenderVerificationRequest,
  ): Promise<VerificationEvidence> {
    const inputHash = hashCanonical({
      block: request.block,
      context: request.context,
    });
    const state = this.createState(
      'dynamic-server-render',
      request.block.name,
      request.expectedEnvironment,
      inputHash,
    );
    const environmentFailure = await this.checkInitialEnvironment(state);
    if (environmentFailure) {
      return environmentFailure;
    }

    try {
      state.activeStage = 'server-render';
      const rendered = await this.runtime.renderDynamic(
        request.block,
        request.context,
      );
      if (!rendered.executed || typeof rendered.html !== 'string') {
        addStage(
          state,
          'server-render',
          'failed',
          state.inputHash,
          null,
        );
        throw new VerificationExecutionError(
          'server-render',
          'server-render-not-executed',
          'Exact runtime did not execute the server render callback',
        );
      }

      state.outputHash = hashText(rendered.html);
      addStage(
        state,
        'server-render',
        'success',
        state.inputHash,
        state.outputHash,
      );

      return await this.finishSuccessfulExecution(
        state,
        request.expectedOutputHash,
        'server-render-valid',
      );
    } catch (error) {
      return await this.finishFailedExecution(state, error);
    }
  }

  private createState(
    kind: VerificationKind,
    blockName: string,
    expectedEnvironment: ExactEnvironment,
    inputHash: string,
  ): ExecutionState {
    const parsedEnvironment =
      ExactEnvironmentSchema.parse(expectedEnvironment);
    return {
      kind,
      blockName,
      expectedEnvironment: parsedEnvironment,
      expectedEnvironmentHash:
        hashExactEnvironment(parsedEnvironment),
      observedEnvironmentBefore: null,
      observedEnvironmentAfter: null,
      inputHash,
      outputHash: null,
      stages: [],
      activeStage: 'environment',
    };
  }

  private async checkInitialEnvironment(
    state: ExecutionState,
  ): Promise<VerificationEvidence | null> {
    try {
      const observed = ExactEnvironmentSchema.parse(
        await this.runtime.getEnvironment(),
      );
      state.observedEnvironmentBefore = observed;
      const observedHash = hashExactEnvironment(observed);
      addStage(
        state,
        'environment',
        observedHash === state.expectedEnvironmentHash
          ? 'success'
          : 'failed',
        state.expectedEnvironmentHash,
        observedHash,
        { phase: 'before' },
      );
      if (observedHash !== state.expectedEnvironmentHash) {
        state.observedEnvironmentAfter = observed;
        return fail(
          state,
          'drift',
          'environment',
          'environment-mismatch',
          'Runtime environment does not match requested environment',
        );
      }
      return null;
    } catch (error) {
      return fail(
        state,
        'failed',
        'environment',
        'environment-unavailable',
        this.errorMessage(error),
      );
    }
  }

  private async finishSuccessfulExecution(
    state: ExecutionState,
    expectedOutputHash: string | undefined,
    label: RuntimeVerificationLabel,
  ): Promise<VerificationEvidence> {
    const environmentFailure =
      await this.checkFinalEnvironment(state);
    if (environmentFailure) {
      return environmentFailure;
    }

    if (
      expectedOutputHash !== undefined &&
      state.outputHash !== expectedOutputHash
    ) {
      return fail(
        state,
        'drift',
        state.kind === 'dynamic-server-render'
          ? 'server-render'
          : 'save',
        'output-drift',
        'Runtime output hash differs from expected output hash',
      );
    }

    return finalize(state, {
      status: 'passed',
      label,
    });
  }

  private async finishFailedExecution(
    state: ExecutionState,
    error: unknown,
  ): Promise<VerificationEvidence> {
    const environmentFailure =
      await this.checkFinalEnvironment(state);
    if (environmentFailure) {
      return environmentFailure;
    }

    if (error instanceof VerificationExecutionError) {
      return fail(
        state,
        'failed',
        error.stage,
        error.code,
        error.message,
      );
    }

    return fail(
      state,
      'failed',
      state.activeStage,
      'runtime-error',
      this.errorMessage(error),
    );
  }

  private async checkFinalEnvironment(
    state: ExecutionState,
  ): Promise<VerificationEvidence | null> {
    try {
      const observed = ExactEnvironmentSchema.parse(
        await this.runtime.getEnvironment(),
      );
      state.observedEnvironmentAfter = observed;
      const observedHash = hashExactEnvironment(observed);
      addStage(
        state,
        'environment',
        observedHash === state.expectedEnvironmentHash
          ? 'success'
          : 'failed',
        state.expectedEnvironmentHash,
        observedHash,
        { phase: 'after' },
      );
      if (observedHash !== state.expectedEnvironmentHash) {
        return fail(
          state,
          'drift',
          'environment',
          'environment-drift',
          'Runtime environment changed during verification',
        );
      }
      return null;
    } catch (error) {
      return fail(
        state,
        'failed',
        'environment',
        'environment-unavailable',
        this.errorMessage(error),
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
