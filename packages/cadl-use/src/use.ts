import fs from "fs";
import url from "url";
import path from "path";
import {
  createDecoratorDefinition,
  createProgram,
  DecoratorContext,
  formatDiagnostic,
  InterfaceType,
  NamespaceType,
  NodeHost,
  OperationType,
  Program,
  Type,
} from "@cadl-lang/compiler";
import { getRestOperationDefinition } from "./rest.js";
import { writeClientFile, writeOperationFile } from "./write.js";
import { OperationDetails } from "@cadl-lang/rest/http";
import { BICEPS } from "./biceps.js";
import { Interface } from "readline";

const SCHEMA_DIR = path.join(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
  "schemas"
);

const useDefinition = createDecoratorDefinition({
  name: "@use",
  args: [
    {
      kind: ["String", "Namespace", "Interface", "Operation"],
      optional: false,
    },
  ] as const,
  target: ["Namespace", "Interface"],
});

const $_use = Symbol("cadl-use::use");

type UseScope = NamespaceType | InterfaceType;
type UseSelector = string | NamespaceType | OperationType | InterfaceType;

export async function $use(
  context: DecoratorContext,
  target: UseScope,
  selector: UseSelector
) {
  if (!useDefinition.validate(context, target, [selector as any])) return;

  let value = context.program.stateMap($_use).get(target) as
    | UseSelector[]
    | undefined;

  if (!value) {
    value = [];
    context.program.stateMap($_use).set(target, value);
  }

  value.push(selector);
}

export function getUses(
  program: Program,
  t: NamespaceType | InterfaceType
): OperationDetails[] {
  return program.stateMap($_use).get(t) ?? [];
}

export async function $onEmit(program: Program): Promise<void> {
  if (!program.compilerOptions.outputPath) return;

  const outputPath = path.join(program.compilerOptions.outputPath, "use");
  const apps = [...program.stateMap($_use).entries()];

  if (apps.length === 0) return;

  const resolutions = await Promise.all(
    (apps as [UseScope, UseSelector[]][]).flatMap(([appNamespace, selectors]) =>
      selectors.map((selector) => {
        if (typeof selector === "string") {
          return resolveSelector(program, appNamespace, selector);
        } else {
          const resolution: UseResolution = {
            name: selector.name,
            ns: selector.namespace!.name,
            program,
            type: selector,
          };

          return resolution;
        }
      })
    )
  );

  const files = resolutions.map(
    ({ name, program: schemaProgram, type, ns }) => {
      const contents =
        type.kind === "Operation"
          ? writeOperationFile(
              schemaProgram,
              getRestOperationDefinition(schemaProgram, type)
            )
          : writeClientFile(schemaProgram, type);
      return [
        path.join(
          outputPath,
          ns
            .split(".")
            .map((s) => s.toLowerCase())
            .at(-1)!,
          name.split(".").at(-1)!
        ) + ".ts",
        contents,
      ];
    }
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

async function resolveSelector(
  hostProgram: Program,
  scope: UseScope,
  name: string
): Promise<UseResolution> {
  let selectedSchema = Object.entries(KNOWN_SCHEMA_PREFIXES).find(([prefix]) =>
    name.startsWith(prefix)
  );

  let program = hostProgram;
  let type: UseResolution["type"] | undefined;

  if (selectedSchema) {
    const schemaFilePath = path.join(SCHEMA_DIR, `${selectedSchema[1]}.cadl`);

    // Biceps
    BICEPS[selectedSchema[1]]?.();

    program = await createProgram(NodeHost, schemaFilePath, {
      noEmit: true,
    });

    if (program.hasError()) {
      for (const diagnostic of program.diagnostics.map(formatDiagnostic)) {
        console.error(diagnostic);
      }

      throw new Error("Internal errors occurred during schema compilation.");
    }

    type = select(
      program.checker.getGlobalNamespaceType(),
      name.split(".")
    ) as UseResolution["type"];
  } else {
    // No well-known schema was selected, so try to resolve it relative to the host program.
    type = select(scope.namespace, name.split(".")) as UseResolution["type"];
  }

  if (!type) {
    throw new Error(`Unable to resolve '${name}'.`);
  } else if (!["Operation", "Interface", "Namespace"].includes(type.kind)) {
    throw new Error(
      `${name} resolved to '${type.kind}', but expected an Operation, Interface, or Namespace`
    );
  }

  const output = {
    name,
    ns:
      scope.kind === "Namespace"
        ? hostProgram.checker.getNamespaceString(scope)
        : hostProgram.checker.getNamespaceString(scope.namespace) +
          "." +
          scope.name,
    type,
    program,
  };

  if (output.ns.startsWith(".")) output.ns = output.ns.slice(1);

  return output;
}

interface UseResolution {
  name: string;
  ns: string;
  program: Program;
  type: OperationType | InterfaceType | NamespaceType;
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

  process.stdout.write(writeOperationFile(program, definition));

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
    return t.namespaces.get(s) ?? t.interfaces.get(s) ?? t.operations.get(s);
  }
}
