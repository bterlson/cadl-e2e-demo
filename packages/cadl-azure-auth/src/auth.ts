import {
  createDecoratorDefinition,
  DecoratorContext,
  Interface,
  Namespace,
} from "@cadl-lang/compiler";
import { apiKeyKey, scopeKey } from "./lib.js";

const apiKeyDefinition = createDecoratorDefinition({
  name: "@apiKey",
  target: ["Namespace", "Interface"],
  args: [{ kind: "String" as const, optional: false }],
});

export function $apiKey(
  ctx: DecoratorContext,
  entity: Namespace | Interface,
  header: string
) {
  if (!apiKeyDefinition.validate(ctx, entity, [header])) return;

  ctx.program.stateMap(apiKeyKey).set(entity, header);
}

const scopeDefinition = createDecoratorDefinition({
  name: "@scope",
  target: ["Namespace", "Interface"],
  args: [{ kind: "String" as const, optional: false }],
});

export function $scope(
  ctx: DecoratorContext,
  target: Namespace | Interface,
  name: string
) {
  if (!scopeDefinition.validate(ctx, target, [name])) return;

  ctx.program.stateMap(scopeKey).set(target, name);
}

export const namespace = "Azure.Auth";
