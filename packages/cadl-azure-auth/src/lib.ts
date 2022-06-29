import {
  createCadlLibrary,
  InterfaceType,
  NamespaceType,
  OperationType,
  Program,
} from "@cadl-lang/compiler";

const { reportDiagnostic } = createCadlLibrary({
  name: "cadl-azure-auth",
  diagnostics: {},
});

export { reportDiagnostic };

export const apiKeyKey = Symbol.for("cadl-azure-auth::api");
export const scopeKey = Symbol.for("cadl-azure-auth::scope");

export interface SecurityDefinition {
  scopes?: string;
  keyHeader?: string;
  allowAnonymous: boolean;
}

export function resolveSecurity(
  program: Program,
  operation: OperationType
): SecurityDefinition {
  let scopes: string | undefined, keyHeader: string | undefined;

  (function backtrack(item: NamespaceType | InterfaceType | undefined) {
    if (!item) return;

    scopes ??= program.stateMap(scopeKey).get(item) as string;
    keyHeader ??= program.stateMap(apiKeyKey).get(item) as string;

    backtrack(item.namespace);
  })(operation.interface ?? operation.namespace);

  return {
    scopes,
    keyHeader,
    allowAnonymous: false,
  };
}
