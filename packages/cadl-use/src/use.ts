import fs from "fs";
import url from "url";
import path from "path";
import {
  createProgram,
  formatDiagnostic,
  NamespaceType,
  NodeHost,
  OperationType,
  Type,
} from "@cadl-lang/compiler";
import { getRestOperationDefinition } from "./rest.js";
import { writeFile } from "./write.js";

const SCHEMA_DIR = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
  "schemas"
);

export async function use(args: string[]): Promise<void> {
  const [serviceAndVersion, ...selectorStrings] = args;

  const [service, version] = serviceAndVersion.split("/");

  const schemaFilePath = path.join(SCHEMA_DIR, `${service}.cadl`);

  console.error("Cadl Use");

  if (!fs.statSync(schemaFilePath, { throwIfNoEntry: false })) {
    console.error("No such schema:", schemaFilePath);
    process.exit(1);
  }

  console.error("Using service schema:", service);
  if (version) {
    console.error("Using service version:", version);
  }

  console.error("Compiling schemas...");

  const program = await createProgram(NodeHost, schemaFilePath, {
    noEmit: true,
  });

  if (program.hasError()) {
    console.error("Errors occurred while compiling schema:");
    for (const diagnostic of program.diagnostics.map(formatDiagnostic)) {
      console.error(diagnostic);
    }
    process.exit(1);
  }

  const root = program.checker.getGlobalNamespaceType();

  const selectors = selectorStrings.map((s) => s.split("."));

  const wantedOperations = selectors
    .map((s) => {
      try {
        const t = select(root, s);

        if (!t || t.kind !== "Operation") {
          console.error("Not an operation:", s);
          return undefined;
        } else {
          return t;
        }
      } catch {
        console.error("No such specification", s);
      }
    })
    .filter((t) => !!t);

  if (wantedOperations.length === 0) {
    console.error("No operations selected.");
    process.exit(1);
  }

  const [operation] = wantedOperations as OperationType[];

  if (wantedOperations.length > 1) {
    console.warn(
      "Multiple operations not yet supported, using only the first one:",
      operation.name
    );
  }

  const definition = getRestOperationDefinition(program, operation);

  process.stdout.write(writeFile(program, definition));

  return;

  function select(t: Type | undefined, selector: string[]): Type | undefined {
    if (selector.length <= 0) return t;

    if (!t) {
      throw new Error("No such type.");
    }

    const [first, ...rest] = selector;

    switch (t.kind) {
      case "Namespace":
        return select(getNamespaceChild(t, first), rest);
      case "Interface":
        return select(t.operations.get(first), rest);
      default:
        throw new Error(`Cannot select into '${first}' of ${t.kind}`);
    }
  }

  function getNamespaceChild(t: NamespaceType, s: string): Type | undefined {
    return t.namespaces.get(s) ?? t.operations.get(s);
  }
}
