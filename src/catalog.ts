import type {
  BlockDefinition,
  CatalogArtifact,
  Environment,
} from './schema.js';
import { CatalogArtifactSchema } from './schema.js';

export interface ResolvedBlock {
  definition: BlockDefinition;
  shadowed: BlockDefinition[];
}

export interface SearchOptions {
  environment: string;
  query: string;
  product?: BlockDefinition['product'];
  limit?: number;
}

function environmentPriorities(environment: Environment): Map<string, number> {
  return new Map(
    environment.layers.map((layer) => [ layer.sourceId, layer.priority ]),
  );
}

export class Catalog {
  readonly artifact: CatalogArtifact;
  private readonly environments: Map<string, Environment>;
  private readonly blocksByName: Map<string, BlockDefinition[]>;

  constructor(input: unknown) {
    this.artifact = CatalogArtifactSchema.parse(input);
    this.environments = new Map(
      this.artifact.environments.map((environment) => [
        environment.id,
        environment,
      ]),
    );
    this.blocksByName = new Map();

    for (const block of this.artifact.blocks) {
      const definitions = this.blocksByName.get(block.name) ?? [];
      definitions.push(block);
      this.blocksByName.set(block.name, definitions);
    }
  }

  withDefinitions(definitions: BlockDefinition[]): Catalog {
    if (definitions.length === 0) {
      return this;
    }

    const environments = new Map(
      this.artifact.environments.map((environment) => [
        environment.id,
        environment,
      ]),
    );
    const definitionIds = new Set(this.artifact.blocks.map(({ id }) => id));

    for (const definition of definitions) {
      if (definitionIds.has(definition.id)) {
        throw new Error(`Duplicate promoted definition ${definition.id}`);
      }
      definitionIds.add(definition.id);

      const runtime = definition.runtimeProvenance;
      if (
        definition.visibility !== 'private' ||
        !runtime ||
        definition.sourceId !==
          `runtime-observed:${runtime.environmentId}` ||
        definition.product !== 'runtime-observed' ||
        definition.provenance.kind !== 'runtime-capture'
      ) {
        throw new Error(
          `Runtime definition ${definition.id} requires source-neutral provenance`,
        );
      }

      const environment = environments.get(
        runtime.environmentId,
      );
      if (
        !environment ||
        environment.visibility !== 'private'
      ) {
        throw new Error(
          `Runtime definition ${definition.id} requires its private environment`,
        );
      }
      if (this.resolve(definition.name, environment.id)) {
        throw new Error(
          `Runtime definition ${definition.id} is no longer source-neutral`,
        );
      }
    }

    return new Catalog({
      ...this.artifact,
      blocks: [ ...this.artifact.blocks, ...definitions ],
    });
  }

  resolve(name: string, environmentId: string): ResolvedBlock | null {
    const environment = this.environments.get(environmentId);
    if (!environment) {
      throw new Error(`Unknown environment: ${environmentId}`);
    }

    const priorities = environmentPriorities(environment);
    const priority = (block: BlockDefinition) =>
      block.runtimeProvenance
        ? Number.MAX_SAFE_INTEGER
        : priorities.get(block.sourceId) ?? Number.MIN_SAFE_INTEGER;
    const candidates = (this.blocksByName.get(name) ?? [])
      .filter((block) =>
        block.runtimeProvenance
          ? block.runtimeProvenance.environmentId === environmentId
          : priorities.has(block.sourceId))
      .sort((left, right) => {
        return priority(right) - priority(left);
      });

    if (candidates.length === 0) {
      return null;
    }

    const winner = candidates[0];
    if (!winner) {
      return null;
    }

    const winnerPriority = priority(winner);
    const conflict = candidates.find(
      (candidate, index) =>
        index > 0 && priority(candidate) === winnerPriority,
    );
    if (conflict) {
      throw new Error(
        `Ambiguous block ${name} in ${environmentId}: ` +
        `${winner.sourceId} and ${conflict.sourceId} share priority ${winnerPriority}`,
      );
    }

    return {
      definition: winner,
      shadowed: candidates.slice(1),
    };
  }

  search(options: SearchOptions): ResolvedBlock[] {
    const query = options.query.trim().toLocaleLowerCase();
    if (!query) {
      return [];
    }

    const limit = options.limit ?? 20;
    const results: Array<{ score: number; resolved: ResolvedBlock }> = [];

    for (const name of this.blocksByName.keys()) {
      const resolved = this.resolve(name, options.environment);
      if (!resolved) {
        continue;
      }
      const block = resolved.definition;
      if (options.product && block.product !== options.product) {
        continue;
      }

      const nameText = block.name.toLocaleLowerCase();
      const title = block.title?.toLocaleLowerCase() ?? '';
      const description = block.description?.toLocaleLowerCase() ?? '';
      const keywords = block.keywords.join(' ').toLocaleLowerCase();

      let score = 0;
      if (nameText === query) score += 100;
      if (nameText.includes(query)) score += 30;
      if (title.includes(query)) score += 20;
      if (keywords.includes(query)) score += 10;
      if (description.includes(query)) score += 5;

      if (score > 0) {
        results.push({ score, resolved });
      }
    }

    return results
      .sort((left, right) => {
        return (
          right.score - left.score ||
          left.resolved.definition.name.localeCompare(
            right.resolved.definition.name,
          )
        );
      })
      .slice(0, limit)
      .map(({ resolved }) => resolved);
  }
}
