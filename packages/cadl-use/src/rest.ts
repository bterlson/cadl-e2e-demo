import { OperationType, Program } from "@cadl-lang/compiler";
import { getAllRoutes, OperationDetails } from "@cadl-lang/rest/http";

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
