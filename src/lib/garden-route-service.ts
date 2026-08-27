import { applyGardenOperation, type Garden, type GardenOperation } from "./personal-dashboard";

export type GardenMutationResult =
  | { status: 200; body: Garden }
  | { status: 409; body: { error: "Garden revision conflict"; garden: Garden } };

export interface GardenTransactionRepository {
  runSerialized<T>(work: (garden: Garden) => Promise<{ result: T; nextGarden?: Garden }>): Promise<T>;
}

type Dependencies = { now?: () => Date; createId?: () => string };

export function handleGardenMutation(
  operation: GardenOperation,
  repository: GardenTransactionRepository,
  dependencies: Dependencies = {},
): Promise<GardenMutationResult> {
  return repository.runSerialized<GardenMutationResult>(async (garden) => {
    if (operation.expectedRevision !== garden.revision) {
      return { result: { status: 409, body: { error: "Garden revision conflict", garden } } as const };
    }
    const next = applyGardenOperation(garden, operation, dependencies.now?.() ?? new Date(), dependencies.createId);
    return { result: { status: 200, body: next } as const, nextGarden: next };
  });
}
