import { createCadlLibrary, paramMessage } from "@cadl-lang/compiler";

export const libDef = {
  name: "cadl-azure-accelerators",
  diagnostics: {
  }
} as const;
const lib = createCadlLibrary(libDef);
export const { reportDiagnostic } = lib;

export type AzureAcceleratorsLib = typeof lib;
