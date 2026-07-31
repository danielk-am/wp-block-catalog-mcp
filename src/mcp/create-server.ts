import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Catalog } from '../catalog.js';
import { hashArtifact, stableStringify } from '../delivery/index.js';
import {
  JsonObjectSchema,
  RuntimeBundleStore,
} from '../runtime/index.js';
import type { RuntimeBlock } from '../verification/index.js';
import {
  VerifiedMarkupStore,
} from '../verified.js';

const RuntimeBlockInputSchema: z.ZodType<RuntimeBlock> = z.lazy(() =>
  z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*\/[a-z0-9-]+$/),
    attributes: JsonObjectSchema.default({}),
    innerBlocks: z.array(RuntimeBlockInputSchema).default([]),
  }).strict(),
);

export function createServer(
  catalog: Catalog,
  verifiedMarkup = new VerifiedMarkupStore(),
  runtimeBundles = new RuntimeBundleStore(),
  options: { defaultEnvironment?: string } = {},
): McpServer {
  const effectiveCatalog = catalog.withDefinitions(runtimeBundles.definitions());
  const environmentIds = new Set(
    effectiveCatalog.artifact.environments.map(({ id }) => id),
  );
  if (
    options.defaultEnvironment &&
    !environmentIds.has(options.defaultEnvironment)
  ) {
    throw new Error(
      `Unknown default environment: ${options.defaultEnvironment}`,
    );
  }

  function requestedEnvironment(
    environment: string | undefined,
  ): string | null {
    const selected = environment ?? options.defaultEnvironment;
    return selected && environmentIds.has(selected) ? selected : null;
  }

  function environmentError(environment: string | undefined) {
    const reason = environment
      ? `Unknown environment: ${environment}`
      : 'An environment is required because no default is configured';
    return {
      content: [ { type: 'text' as const, text: reason } ],
      structuredContent: {
        error: reason,
        availableEnvironments: [ ...environmentIds ],
      },
      isError: true,
    };
  }

  const server = new McpServer({
    name: 'wp-block-catalog',
    version: '0.1.0',
  });

  server.registerResource(
    'catalogue-manifest',
    'wp-block-catalog://manifest',
    {
      title: 'WordPress block catalogue manifest',
      description:
        'Pinned source and environment manifest for this catalogue release.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            schemaVersion: effectiveCatalog.artifact.schemaVersion,
            catalogVersion: effectiveCatalog.artifact.catalogVersion,
            artifactHash: hashArtifact(effectiveCatalog.artifact),
            generatedAt: effectiveCatalog.artifact.generatedAt,
            sources: effectiveCatalog.artifact.sources,
            environments: effectiveCatalog.artifact.environments,
            runtime: effectiveCatalog.artifact.environments
              .map(({ id }) => runtimeBundles.bundle(id))
              .filter((bundle) => bundle !== null)
              .map((bundle) => ({
                environmentId: bundle.environmentId,
                profileHash: bundle.profileHash,
                serverRegistryHash: bundle.serverRegistryHash,
                clientRegistryHash: bundle.clientRegistryHash,
                serverCapturedAt: bundle.serverCapturedAt ?? null,
                clientCapturedAt: bundle.clientCapturedAt ?? null,
                serverOnly: bundle.serverOnly,
                clientOnly: bundle.clientOnly,
                sourceOnly: bundle.sourceOnly,
              })),
          }),
        },
      ],
    }),
  );

  server.registerResource(
    'block-definition',
    new ResourceTemplate(
      'wp-block-catalog://blocks/{environment}/{name}',
      {
        list: undefined,
        complete: {
          environment: (value) =>
            effectiveCatalog.artifact.environments
              .map(({ id }) => id)
              .filter((id) => id.includes(value))
              .slice(0, 100),
          name: (value) =>
            [
              ...new Set(
                effectiveCatalog.artifact.blocks.map(({ name }) => name),
              ),
            ]
              .filter((name) => name.includes(value))
              .sort()
              .slice(0, 100),
        },
      },
    ),
    {
      title: 'Resolved block definition',
      description:
        'Complete effective block definition and shadowed origins in one environment.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const environment = String(variables.environment);
      const name = String(variables.name);
      const resolved = effectiveCatalog.resolve(name, environment);
      if (!resolved) {
        throw new Error(`Block ${name} was not found in ${environment}`);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              catalogVersion: effectiveCatalog.artifact.catalogVersion,
              environment,
              ...resolved,
              runtime: runtimeBundles.get(environment, name),
              evidence: verifiedMarkup.evidence(environment, name),
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_environments',
    {
      title: 'List block catalogue environments',
      description:
        'List the pinned product environments available in this catalogue artefact.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const environments = effectiveCatalog.artifact.environments.map(
        ({ id, title, visibility, layers, metadata }) => ({
          id,
          title,
          visibility,
          layers,
          metadata,
          runtime: runtimeBundles.bundle(id)
            ? {
                profileHash: runtimeBundles.bundle(id)?.profileHash,
                serverRegistryHash:
                  runtimeBundles.bundle(id)?.serverRegistryHash,
                clientRegistryHash:
                  runtimeBundles.bundle(id)?.clientRegistryHash,
                serverCapturedAt:
                  runtimeBundles.bundle(id)?.serverCapturedAt ?? null,
                clientCapturedAt:
                  runtimeBundles.bundle(id)?.clientCapturedAt ?? null,
              }
            : null,
        }),
      );

      return {
        content: [ { type: 'text', text: JSON.stringify(environments) } ],
        structuredContent: {
          catalogVersion: effectiveCatalog.artifact.catalogVersion,
          environments,
        },
      };
    },
  );

  server.registerTool(
    'search_blocks',
    {
      title: 'Search WordPress blocks',
      description:
        'Search resolved blocks in a pinned product environment. Results include version and provenance.',
      inputSchema: {
        query: z.string().min(1),
        environment: z.string().min(1).optional(),
        product: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
        source: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        block_type: z.enum([ 'static', 'dynamic', 'hybrid' ]).optional(),
        include_removed: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      query,
      environment: environmentInput,
      product,
      source,
      category,
      block_type: blockType,
      include_removed: includeRemoved,
      limit,
    }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const results = effectiveCatalog.search({
        query,
        environment,
        ...(product ? { product } : {}),
        limit: 100,
      }).map(({ definition, shadowed }) => {
        const runtime = runtimeBundles.get(environment, definition.name);
        const runtimeType = runtime?.server?.isDynamic === true
          ? 'dynamic'
          : runtime?.server?.isDynamic === false
            ? 'static'
            : 'hybrid';
        return {
        name: definition.name,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        product: definition.product,
        sourceId: definition.sourceId,
        productVersion: definition.productVersion,
        verification: definition.verification,
        availability: runtime?.availability ?? definition.availability,
        blockType: runtimeType,
        provenance: definition.provenance,
        runtimeProvenance: definition.runtimeProvenance ?? null,
        shadowedSources: shadowed.map((block) => block.sourceId),
        runtimeDriftCount: runtime?.drift.length ?? null,
        };
      }).filter((result) =>
        (!source ||
          result.sourceId === source ||
          result.product === source) &&
        (!category || result.category === category) &&
        (!blockType || result.blockType === blockType) &&
        (includeRemoved === true ||
          result.availability.state !== 'removed'))
        .slice(0, limit ?? 20);

      return {
        content: [ { type: 'text', text: JSON.stringify(results) } ],
        structuredContent: {
          catalogVersion: effectiveCatalog.artifact.catalogVersion,
          environment,
          results,
        },
      };
    },
  );

  server.registerTool(
    'get_block',
    {
      title: 'Get a resolved WordPress block',
      description:
        'Return the complete resolved block definition, relationships, provenance, and shadowed definitions.',
      inputSchema: {
        name: z.string().min(1),
        environment: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, environment }) => {
      const resolved = effectiveCatalog.resolve(name, environment);
      if (!resolved) {
        return {
          content: [
            {
              type: 'text',
              text: `Block ${name} was not found in environment ${environment}`,
            },
          ],
          isError: true,
        };
      }

      const result = {
        definition: resolved.definition,
        shadowed: resolved.shadowed,
        runtime: runtimeBundles.get(environment, name),
        evidence: verifiedMarkup.evidence(environment, name),
      };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: {
          catalogVersion: effectiveCatalog.artifact.catalogVersion,
          environment,
          ...result,
        },
      };
    },
  );

  server.registerTool(
    'get_block_schema',
    {
      title: 'Get block schema (prototype compatibility)',
      description:
        'Compatibility wrapper returning the effective version-aware block schema.',
      inputSchema: {
        block_name: z.string().min(1),
        environment: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ block_name: name, environment: environmentInput }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const resolved = effectiveCatalog.resolve(name, environment);
      if (!resolved) {
        return {
          content: [
            {
              type: 'text',
              text: `Block ${name} was not found in ${environment}`,
            },
          ],
          isError: true,
        };
      }
      const result = {
        environment,
        definition: resolved.definition,
        shadowed: resolved.shadowed,
        runtime: runtimeBundles.get(environment, name),
        evidence: verifiedMarkup.evidence(environment, name),
      };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'list_block_attributes',
    {
      title: 'List block attributes (prototype compatibility)',
      description:
        'Compatibility wrapper listing attributes from the effective pinned definition.',
      inputSchema: {
        block_name: z.string().min(1),
        environment: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ block_name: name, environment: environmentInput }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const resolved = effectiveCatalog.resolve(name, environment);
      if (!resolved) {
        return {
          content: [
            {
              type: 'text',
              text: `Block ${name} was not found in ${environment}`,
            },
          ],
          isError: true,
        };
      }
      const attributes = Object.entries(resolved.definition.attributes)
        .map(([ attribute, schema ]) => ({ attribute, schema }));
      const result = { environment, name, attributes };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'search_variations',
    {
      title: 'Search block variations (prototype compatibility)',
      description:
        'Search effective block variations inside one pinned environment.',
      inputSchema: {
        query: z.string().min(1),
        environment: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, environment: environmentInput, limit }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const needle = query.toLocaleLowerCase();
      const names = [
        ...new Set(effectiveCatalog.artifact.blocks.map(({ name }) => name)),
      ].sort();
      const results = names.flatMap((name) => {
        const resolved = effectiveCatalog.resolve(name, environment);
        if (!resolved) return [];
        return resolved.definition.variations
          .map((variation) => ({
            blockName: name,
            product: resolved.definition.product,
            variation,
          }))
          .filter(({ variation }) =>
            stableStringify(variation).toLocaleLowerCase().includes(needle));
      }).slice(0, limit ?? 20);
      return {
        content: [ { type: 'text', text: JSON.stringify(results) } ],
        structuredContent: { environment, query, results },
      };
    },
  );

  server.registerTool(
    'get_runtime_drift',
    {
      title: 'Get reconciled block runtime drift',
      description:
        'Return source, server, and client observations plus explicit drift for one block profile.',
      inputSchema: {
        environment: z.string().min(1),
        name: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ environment, name }) => {
      const runtime = runtimeBundles.get(environment, name);
      if (!runtime) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No reconciled runtime snapshot exists for ${name} ` +
                `in ${environment}`,
            },
          ],
          structuredContent: {
            environment,
            name,
            observed: false,
          },
          isError: true,
        };
      }
      const result = {
        environment,
        name,
        observed: true,
        runtime,
      };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'compare_block_versions',
    {
      title: 'Compare resolved block versions',
      description:
        'Compare the effective definition of one block across two pinned environments.',
      inputSchema: {
        name: z.string().min(1),
        fromEnvironment: z.string().min(1),
        toEnvironment: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name, fromEnvironment, toEnvironment }) => {
      const before = effectiveCatalog.resolve(name, fromEnvironment);
      const after = effectiveCatalog.resolve(name, toEnvironment);
      if (!before || !after) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Block ${name} must resolve in both ` +
                `${fromEnvironment} and ${toEnvironment}`,
            },
          ],
          isError: true,
        };
      }

      const fields = [
        'sourceId',
        'product',
        'productVersion',
        'title',
        'description',
        'category',
        'apiVersion',
        'attributes',
        'supports',
        'availability',
        'relationships',
        'variations',
        'verification',
        'provenance',
      ] as const;
      const changes = fields
        .filter((field) =>
          stableStringify(before.definition[field]) !==
          stableStringify(after.definition[field]))
        .map((field) => ({
          field,
          before: before.definition[field],
          after: after.definition[field],
        }));
      const result = {
        name,
        fromEnvironment,
        toEnvironment,
        changed: changes.length > 0,
        changes,
        before: before.definition,
        after: after.definition,
      };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'generate_markup',
    {
      title: 'Retrieve verified block markup',
      description:
        'Return markup only when the exact block input has passed the matching runtime verifier.',
      inputSchema: {
        environment: z.string().min(1),
        name: z.string().min(1),
        attributes: z.record(z.string(), z.unknown()).optional(),
        innerBlocks: z.array(z.unknown()).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ environment, name, attributes, innerBlocks, context }) => {
      const block = RuntimeBlockInputSchema.parse({
        name,
        attributes: attributes ?? {},
        innerBlocks: innerBlocks ?? [],
      });
      const parsedContext = JsonObjectSchema.parse(context ?? {});
      const record = verifiedMarkup.generate(
        environment,
        block,
        parsedContext,
      );
      if (!record) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No exact runtime-verified markup exists for ${name} ` +
                `in ${environment} with that input`,
            },
          ],
          structuredContent: {
            environment,
            name,
            verified: false,
          },
          isError: true,
        };
      }
      const result = {
        environment,
        name,
        verified: true,
        markup: record.markup,
        evidence: record.evidence,
      };
      return {
        content: [ { type: 'text', text: record.markup } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'get_block_markup',
    {
      title: 'Get verified block markup (prototype compatibility)',
      description:
        'Compatibility wrapper returning only exact-runtime verified markup examples.',
      inputSchema: {
        block_name: z.string().min(1),
        environment: z.string().min(1).optional(),
        features: z.array(z.string()).optional(),
        validated_only: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      block_name: name,
      environment: environmentInput,
    }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const records = verifiedMarkup.records(environment, name);
      if (records.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No exact runtime-verified markup exists for ${name} ` +
                `in ${environment}`,
            },
          ],
          structuredContent: {
            environment,
            name,
            verified: false,
            examples: [],
          },
          isError: true,
        };
      }
      const examples = records.map(({ id, markup, evidence }) => ({
        id,
        markup,
        evidence,
      }));
      return {
        content: [ { type: 'text', text: JSON.stringify(examples) } ],
        structuredContent: {
          environment,
          name,
          verified: true,
          examples,
        },
      };
    },
  );

  server.registerTool(
    'validate_markup',
    {
      title: 'Validate block markup evidence',
      description:
        'Confirm whether these exact markup bytes have passed the matching runtime verifier.',
      inputSchema: {
        environment: z.string().min(1).optional(),
        markup: z.string(),
        name: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ environment: environmentInput, markup, name }) => {
      const environment = requestedEnvironment(environmentInput);
      if (!environment) {
        return environmentError(environmentInput);
      }
      const record = verifiedMarkup.validate(environment, markup, name);
      const result = record
        ? {
            environment,
            name: record.block.name,
            verified: true,
            evidence: record.evidence,
          }
        : {
            environment,
            ...(name ? { name } : {}),
            verified: false,
            reason:
              'No passed exact-runtime evidence matches these markup bytes.',
          };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'get_verification_evidence',
    {
      title: 'Get block verification evidence',
      description:
        'List exact-environment runtime evidence for a resolved block.',
      inputSchema: {
        environment: z.string().min(1),
        name: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ environment, name }) => {
      const evidence = verifiedMarkup.evidence(environment, name);
      const result = { environment, name, evidence };
      return {
        content: [ { type: 'text', text: JSON.stringify(result) } ],
        structuredContent: result,
      };
    },
  );

  return server;
}
