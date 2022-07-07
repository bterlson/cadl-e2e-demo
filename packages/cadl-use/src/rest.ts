import {
  InterfaceType,
  NamespaceType,
  OperationType,
  Program,
} from "@cadl-lang/compiler";
import {
  getAllRoutes,
  OperationContainer,
  OperationDetails,
} from "@cadl-lang/rest/http";

export function getRestOperationDefinition(
  program: Program,
  operation: OperationType
): OperationDetails {
  const [routes, _diagnostics] = getAllRoutes(program);
  const [info] = routes.filter((r) => r.operation === operation);
  if (!info) {
    throw new Error("No route for operation.");
  }
  return info;
}

export function getRestOperationsWithin(
  program: Program,
  scope: OperationContainer
): OperationDetails[] {
  const [routes, _diagnostics] = getAllRoutes(program);
  return routes.filter((r) => r.container === scope);
}
