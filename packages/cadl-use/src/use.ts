import fs from "fs";
import url from "url";
import path from "path";
import {
  createDecoratorDefinition,
  createProgram,
  DecoratorContext,
  formatDiagnostic,
  NamespaceType,
  NodeHost,
  OperationType,
  Program,
  Type,
} from "@cadl-lang/compiler";
import { getRestOperationDefinition } from "./rest.js";
import { writeFile } from "./write.js";
import { OperationDetails } from "@cadl-lang/rest/http";
import { BICEPS } from "./biceps.js";

const SCHEMA_DIR = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
  "schemas"
);

const useDefinition = createDecoratorDefinition({
  name: "@use",
  args: [
    {
      kind: "String",
      optional: false,
    },
  ] as const,
  target: "Namespace",
});

const $_use = Symbol("cadl-use::use");

export async function $use(
  context: DecoratorContext,
  target: NamespaceType,
  name: string
) {
  if (!useDefinition.validate(context, target, [name])) return;

  let value = context.program.stateMap($_use).get(target) as
    | string[]
    | undefined;

  if (!value) {
    value = [];
    context.program.stateMap($_use).set(target, value);
  }

  value.push(name);
}

export function getUses(
  program: Program,
  t: NamespaceType
): OperationDetails[] {
  return program.stateMap($_use).get(t) ?? [];
}

export async function $onEmit(program: Program): Promise<void> {
  if (!program.compilerOptions.outputPath) return;

  const outputPath = path.join(program.compilerOptions.outputPath, "use");
  const apps = [...program.stateMap($_use).entries()];

  if (apps.length > 1) {
    throw new Error("More than one app not yet supported.");
  } else if (apps.length === 0) return;

  const [[_appNamespace, operationSelectors]] = apps as [
    NamespaceType,
    string[]
  ][];

  const resolutions = await Promise.all(
    operationSelectors.map(resolveOperation)
  );

  const files = resolutions.map(
    ({ name, program: schemaProgram, operation }) => [
      path.join(outputPath, ...name.split(".")) + ".ts",
      writeFile(
        schemaProgram,
        getRestOperationDefinition(schemaProgram, operation)
      ),
    ]
  );

  for (const [name, contents] of files) {
    await program.host.mkdirp(path.dirname(name));
    await program.host.writeFile(name, contents);
  }
}

const KNOWN_SCHEMA_PREFIXES = {
  "Microsoft.KeyVault": "keyvault",
  "Azure.AI.TextAnalytics": "textanalytics",
} as const;

async function resolveOperation(name: string): Promise<OperationResolution> {
  const selectedSchema = Object.entries(KNOWN_SCHEMA_PREFIXES).find(
    ([prefix]) => name.startsWith(prefix)
  );

  if (!selectedSchema) throw new Error("No known schema for API " + name);

  const schemaFilePath = path.join(SCHEMA_DIR, `${selectedSchema[1]}.cadl`);

  // Biceps
  BICEPS[selectedSchema[1]]?.();

  const program = await createProgram(NodeHost, schemaFilePath, {
    noEmit: true,
  });

  if (program.hasError()) {
    for (const diagnostic of program.diagnostics.map(formatDiagnostic)) {
      console.error(diagnostic);
    }

    throw new Error("Internal errors occurred during schema compilation.");
  }

  const operation = select(
    program.checker.getGlobalNamespaceType(),
    name.split(".")
  );

  if (operation?.kind !== "Operation") {
    throw new Error("Reference does not indicate an operation.");
  }

  return {
    name,
    operation,
    program,
  };
}

interface OperationResolution {
  name: string;
  program: Program;
  operation: OperationType;
}

export async function main(args: string[]): Promise<void> {
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
}

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

  function getNamespaceChild(t: NamespaceType, s: string): Type | undefined {
    return t.namespaces.get(s) ?? t.operations.get(s);
  }
}
