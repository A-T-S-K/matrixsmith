import { builtInDrivers, DriverRegistry } from "../drivers/registry";

/** DEV-only fixture: downgrade routine plans to exercise confirmation without
 * granting an unverified capability or changing the shipped profile evidence. */
export function experimentalRegistry(): DriverRegistry {
  return new DriverRegistry(
    builtInDrivers.map((driver) => ({
      ...driver,
      plan(operation, context) {
        return {
          ...driver.plan(operation, context),
          validation: "experimental" as const,
        };
      },
    })),
  );
}
