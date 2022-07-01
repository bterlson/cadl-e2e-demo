import { createCadlLibrary, paramMessage } from "@cadl-lang/compiler";

export const libDef = {
  name: "cadl-azure-web-app",
  diagnostics: {
  },
  emitter: {
    names: ["default"],
  },
} as const;
const lib = createCadlLibrary(libDef);
export const { reportDiagnostic } = lib;

export type SwaLibrary = typeof lib;
