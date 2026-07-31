import { z } from 'zod';

import {
  VerificationEvidenceSchema,
  hashCanonical,
  hashText,
} from './verification/index.js';
import type {
  JsonObject,
  RuntimeBlock,
  VerificationEvidence,
} from './verification/index.js';

export const VerifiedMarkupRecordSchema = z
  .object({
    id: z.string().min(1),
    environmentId: z.string().min(1),
    block: z.object({
      name: z.string().regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/),
      attributes: z.record(z.string(), z.unknown()),
      innerBlocks: z.array(z.unknown()),
    }),
    context: z.record(z.string(), z.unknown()),
    fixtureMarkup: z.string().nullable(),
    markup: z.string(),
    evidence: VerificationEvidenceSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const evidence = record.evidence;
    if (
      evidence.status !== 'passed' ||
      evidence.blockName !== record.block.name ||
      evidence.expectedEnvironment.id !== record.environmentId ||
      evidence.outputHash !== hashText(record.markup)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Stored markup does not match passed runtime evidence',
        path: [ 'evidence' ],
      });
      return;
    }

    let expectedInputHash: string;
    if (evidence.kind === 'static-save') {
      expectedInputHash = hashCanonical(record.block);
    } else if (evidence.kind === 'dynamic-server-render') {
      expectedInputHash = hashCanonical({
        block: record.block,
        context: record.context,
      });
    } else {
      expectedInputHash = hashText(record.fixtureMarkup ?? '');
    }

    if (evidence.inputHash !== expectedInputHash) {
      context.addIssue({
        code: 'custom',
        message: 'Stored input does not match runtime evidence',
        path: [ 'evidence', 'inputHash' ],
      });
    }
  });

export type VerifiedMarkupRecord = z.infer<
  typeof VerifiedMarkupRecordSchema
>;

export const VerifiedMarkupBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z.array(VerifiedMarkupRecordSchema),
  })
  .strict();

export type VerifiedMarkupBundle = z.infer<
  typeof VerifiedMarkupBundleSchema
>;

function runtimeBlock(input: RuntimeBlock): RuntimeBlock {
  return {
    name: input.name,
    attributes: input.attributes,
    innerBlocks: input.innerBlocks.map(runtimeBlock),
  };
}

export class VerifiedMarkupStore {
  readonly bundle: VerifiedMarkupBundle;
  private readonly outputRecords: Map<string, VerifiedMarkupRecord[]>;
  private readonly inputRecords: Map<string, VerifiedMarkupRecord[]>;

  constructor(
    input: unknown | unknown[] = { schemaVersion: 1, records: [] },
  ) {
    const inputs = Array.isArray(input) ? input : [ input ];
    const bundles = inputs.map((candidate) =>
      VerifiedMarkupBundleSchema.parse(candidate));
    this.bundle = {
      schemaVersion: 1,
      records: bundles.flatMap(({ records }) => records),
    };
    this.outputRecords = new Map();
    this.inputRecords = new Map();
    const identities = new Set<string>();

    for (const record of this.bundle.records) {
      const identity = `${record.environmentId}:${record.id}`;
      if (identities.has(identity)) {
        throw new Error(
          `Duplicate verified markup record ${record.id} ` +
          `for ${record.environmentId}`,
        );
      }
      identities.add(identity);

      const output = this.outputRecords.get(record.evidence.outputHash ?? '') ?? [];
      output.push(record);
      this.outputRecords.set(record.evidence.outputHash ?? '', output);

      const input = this.inputRecords.get(record.evidence.inputHash) ?? [];
      input.push(record);
      this.inputRecords.set(record.evidence.inputHash, input);
    }
  }

  generate(
    environmentId: string,
    block: RuntimeBlock,
    context: JsonObject = {},
  ): VerifiedMarkupRecord | null {
    const normalized = runtimeBlock(block);
    const candidates = [
      ...(this.inputRecords.get(hashCanonical(normalized)) ?? []),
      ...(this.inputRecords.get(hashCanonical({
        block: normalized,
        context,
      })) ?? []),
    ];
    return candidates.find((record) =>
      record.environmentId === environmentId &&
      record.block.name === block.name &&
      record.evidence.kind !== 'deprecated-fixture') ?? null;
  }

  validate(
    environmentId: string,
    markup: string,
    blockName?: string,
  ): VerifiedMarkupRecord | null {
    const candidates = this.outputRecords.get(hashText(markup)) ?? [];
    return candidates.find((record) =>
      record.environmentId === environmentId &&
      (blockName === undefined || record.block.name === blockName)) ?? null;
  }

  evidence(
    environmentId: string,
    blockName: string,
  ): VerificationEvidence[] {
    return this.bundle.records
      .filter((record) =>
        record.environmentId === environmentId &&
        record.block.name === blockName)
      .map(({ evidence }) => evidence);
  }

  records(
    environmentId: string,
    blockName: string,
  ): VerifiedMarkupRecord[] {
    return this.bundle.records.filter((record) =>
      record.environmentId === environmentId &&
      record.block.name === blockName);
  }
}
