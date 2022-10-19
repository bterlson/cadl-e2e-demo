import {
  Interface,
  Namespace,
  Operation,
  Program,
} from "@cadl-lang/compiler";
import {
  getAllHttpServices,
  OperationContainer,
  HttpOperation,
} from "@cadl-lang/rest/http";

export function getRestOperationDefinition(
  program: Program,
  operation: Operation
): HttpOperation {
  const [services, _diagnostics] = getAllHttpServices(program);
  const routes = services[0].operations;
  const [info] = routes.filter((r) => r.operation === operation);
  if (!info) {
    throw new Error("No route for operation.");
  }
  return info;
}

export function getRestOperationsWithin(
  program: Program,
  scope: OperationContainer
): HttpOperation[] {
  const [services, _diagnostics] = getAllHttpServices(program);
  const routes = services[0].operations;
  return routes.filter((r) => r.container === scope);
}
