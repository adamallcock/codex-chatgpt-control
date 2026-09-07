import type { OperationConfigurationRequestV1, OperationSurface } from "./types.js";

/** Route existing request fields without rewriting their immutable wire identity. */
export function configurationPowerValues(configuration: Readonly<OperationConfigurationRequestV1>, surface: OperationSurface): readonly unknown[] {
  const values: unknown[] = [];
  if (configuration.reasoning !== undefined) values.push(configuration.reasoning);
  if (surface === "chat" && configuration.additional?.effort !== undefined) values.push(configuration.additional.effort);
  return values;
}

export function configurationHasMenuValues(configuration: Readonly<OperationConfigurationRequestV1>, surface: OperationSurface): boolean {
  return configuration.experience !== undefined || configuration.model !== undefined
    || configuration.modelVersion !== undefined || configuration.mode !== undefined
    || (configuration.additional !== undefined && Object.keys(configuration.additional).some(key => surface !== "chat" || key !== "effort"));
}
