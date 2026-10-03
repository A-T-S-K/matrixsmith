import { builtInDrivers, DriverRegistry } from "../drivers/registry";
import { acceptLocalProfile, withLocalProfiles } from "./registration";
import { profileCompatibility, type ProfileDocument } from "./document";

export function reviewLocalProfile(
  document: ProfileDocument,
  registry: DriverRegistry,
): readonly string[] {
  const problems = [...profileCompatibility(document)];
  if (
    registry.acceptedProfiles.some(
      (entry) =>
        entry.document.namespace === document.namespace &&
        entry.document.id === document.id,
    )
  )
    problems.push(
      "This profile identity is already registered. Duplicate registration is rejected; start a fresh workspace to replace it.",
    );
  if (registry.acceptedProfiles.length >= 16)
    problems.push("Local profile count limit reached.");
  const profiles = registry.drivers.flatMap((driver) => driver.profiles());
  if (profiles.some(({ id }) => id === `${document.namespace}:${document.id}`))
    problems.push("Duplicate profile identity.");
  if (
    profiles.some(({ name }) => name.toLowerCase() === document.matching.name)
  )
    problems.push(
      "Matching name collides with an existing profile; ambiguous registration is rejected.",
    );
  return problems;
}

export function registryWithLocalProfile(
  document: ProfileDocument,
  registry: DriverRegistry,
): DriverRegistry {
  const problems = reviewLocalProfile(document, registry);
  if (problems.length) throw new Error(problems.join(" "));
  const entries = [...registry.acceptedProfiles, acceptLocalProfile(document)];
  return new DriverRegistry(
    builtInDrivers.map((driver) =>
      driver.id === "coolledux" ? withLocalProfiles(driver, entries) : driver,
    ),
    entries,
  );
}
