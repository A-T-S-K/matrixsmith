import { KNOWN_PROFILE_SIGNATURES } from "./known-profiles";
import { DriverRegistry } from "../drivers/registry";
import { acceptLocalProfile, withLocalProfiles } from "./registration";
import { profileCompatibility, type ProfileDocument } from "./document";

export function reviewLocalProfile(
  document: ProfileDocument,
  registry: DriverRegistry,
): readonly string[] {
  const problems = [...profileCompatibility(document)];
  if (!registry.drivers.some((driver) => driver.id === "coolledux"))
    problems.push(
      "The compatible CoolLEDUX implementation is not registered in this workspace.",
    );
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
    profiles.some(
      ({ name }) => name.toLowerCase() === document.matching.name,
    ) ||
    registry.acceptedProfiles.some(
      (entry) => entry.document.matching.name === document.matching.name,
    ) ||
    KNOWN_PROFILE_SIGNATURES.some(
      (signature) => signature.name === document.matching.name,
    )
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
  const accepted = acceptLocalProfile(document);
  const entries = [...registry.acceptedProfiles, accepted];
  return new DriverRegistry(
    registry.drivers.map((driver) =>
      driver.id === "coolledux"
        ? withLocalProfiles(driver, [accepted])
        : driver,
    ),
    entries,
  );
}
