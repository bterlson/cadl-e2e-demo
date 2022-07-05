import {
  EnumType,
  getIntrinsicModelName,
  IntrinsicModelName,
  isIntrinsic,
  ModelType,
  Program,
  Type,
} from "@cadl-lang/compiler";
import { OperationDetails } from "@cadl-lang/rest/http";
import { resolveSecurity } from "cadl-azure-auth";

import prettier from "prettier";

function uncapitalize(s: string): string {
  return s[0].toLowerCase() + s.slice(1);
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function camelCasify(s: string): string {
  return uncapitalize(pascalCasify(s));
}

function pascalCasify(s: string): string {
  return s.split(/[-_]/).map(capitalize).join("");
}

export function writeFile(program: Program, details: OperationDetails): string {
  const method = details.verb?.toUpperCase() ?? "GET";

  const requiredParams = details.parameters.parameters.filter(
    (p) => !p.param.optional
  );

  const optionalParams = details.parameters.parameters.filter(
    (p) => p.param.optional
  );

  const queryParams = details.parameters.parameters.filter(
    (p) => p.type === "query"
  );

  const parametersMap = new Map(
    details.parameters.parameters.map((p) => [p.name, p.param])
  );

  let cachedDeclarations = new Map<Type, string>();
  let cachedTypeScriptTypeNames = new Map<Type, string>();

  let additionalPositionalParams = "";

  let inlineDeclarations = "";

  let body = "";

  for (const p of requiredParams) {
    additionalPositionalParams += `,
    ${camelCasify(p.name)}: ${convertToTypeScript(p.param.type)}`;
  }

  if (details.parameters.body) {
    const bodyModel = details.parameters.body;
    const bodyParamName = camelCasify(bodyModel.name);
    additionalPositionalParams += `,
    ${bodyParamName}: ${convertToTypeScript(
      bodyModel.type,
      pascalCasify(details.operation.name) + "RequestBody"
    )}`;
    body = `,
        body: JSON.stringify(${bodyParamName})`;
  }

  if (optionalParams.length > 0) {
    const optionsBag = program.checker.createAndFinishType({
      kind: "Model",
      name: pascalCasify(details.operation.name) + "Options",
      properties: new Map(
        optionalParams.map((opt) => [
          opt.name,
          program.checker.createAndFinishType({
            kind: "ModelProperty",
            name: opt.name,
            type: opt.param.type,
            node: opt.param.node,
            optional: true,
            decorators: [],
          }),
        ])
      ),
      derivedModels: [],
      decorators: [],
    });

    additionalPositionalParams += `,
    options: ${convertToTypeScript(optionsBag)} = {}`;
  }

  const fragmentReplacer = details.path.replaceAll(/{[a-zA-Z0-9-_]*}/g, (s) => {
    const name = s.slice(1, -1);
    const isOption = parametersMap.get(name)!.optional;
    const camelCaseName = camelCasify(name);
    return isOption
      ? `\${options.${camelCaseName} ?? ""}`
      : `\${${camelCaseName}}`;
  });

  let addQueryParams = "";

  if (queryParams.length > 0) {
    addQueryParams += `\n    const query = "?" + [`;
    for (const { param } of queryParams) {
      const camelCaseName = camelCasify(param.name);
      const location = param.optional
        ? `options.${camelCaseName}`
        : camelCaseName;
      addQueryParams += `\n        ["${param.name}", ${location}],`;
    }
    addQueryParams += `\n    ].filter(([,value]) => !!value).map(v => v.join("=")).join("&");`;
  }

  const endpoint = queryParams.length > 0 ? "path + query" : "path";

  const [responseBodyType] = details.responses
    .filter((r) => r.statusCode.startsWith("2"))
    .flatMap((r) => r.responses.map((r) => r.body?.type))
    .filter((r) => !!r);

  const responseType = !responseBodyType
    ? "void"
    : convertToTypeScript(
        responseBodyType,
        pascalCasify(details.operation.name) + "Result"
      );

  const securityDefinition = resolveSecurity(program, details.operation);

  const credentialVariants = [];

  if (securityDefinition.keyHeader) {
    credentialVariants.push("KeyCredential");
  }

  if (securityDefinition.scopes) {
    credentialVariants.push("TokenCredential");
  }

  const credentialType = [...credentialVariants];

  if (credentialType.length > 0 && securityDefinition.allowAnonymous) {
    credentialType.push("undefined");
  }

  if (credentialType.length > 0) {
    additionalPositionalParams =
      `,\n    credential: ${credentialType.join(" | ")}` +
      additionalPositionalParams;
  }

  let insertAuth =
    credentialType.length > 0 ? ",\n        ...accessHeaders" : "";

  let authorizeBlock = "";

  if (credentialType.length > 0) {
    if (credentialType.length === 2) {
      authorizeBlock = `
    const accessHeaders: Record<string, string> = {};
    if (typeof ((credential as any).getToken) === "function") {
        const accessToken = await ((credential as TokenCredential).getToken("${securityDefinition.scopes}"));
        if (!accessToken) throw new Error("Failed to authorize request: getToken returned null.");
        accessHeaders["Authorization"] = \`Bearer \${accessToken.token}\`;
    } else {
        accessHeaders["${securityDefinition.keyHeader}"] = (credential as KeyCredential).key;
    }\n`;
    } else if (securityDefinition.keyHeader) {
      insertAuth = `,\n        "${securityDefinition.keyHeader}": credential.key`;
    } else if (securityDefinition.scopes) {
      authorizeBlock = `
    const authorization = await credential.getToken("${securityDefinition.scopes}");`;
      insertAuth = `,\n        Authorization: \`Bearer \${authorization?.token}\``;
    }
  }

  const text = `// Generated by Microsoft Cadl

// Requires use of the Azure Identity library
import type { ${credentialVariants.join(", ")} } from "@azure/core-auth";
${inlineDeclarations}
export async function ${details.operation.name}(
    baseUrl: URL${additionalPositionalParams}
): Promise<${responseType}> {
    const path = \`${fragmentReplacer}\`;${addQueryParams}
    const resource = new URL(${endpoint}, baseUrl).toString();
    ${authorizeBlock}
    const res = await fetch(resource, {
        method: "${method}",
        headers: {
            "Content-Type": "application/json"${insertAuth}
        }${body}
    });

    if (res.status < 200 || res.status >= 400) {
        const response = await res.json();
        const e = new Error(response.message);
        throw Object.assign(e, response);
    }

    return res.json();
}

// Inline fetch polyfill?
const fetch =
  typeof globalThis.fetch === "undefined"
    ? (await import("node-fetch")).default
    : globalThis.fetch;
`;

  return prettier.format(text, {
    parser: "typescript",
  });

  function convertToTypeScript(
    t: Type,
    preferredAlternativeName?: string
  ): string {
    if (cachedTypeScriptTypeNames.has(t))
      return cachedTypeScriptTypeNames.get(t)!;

    if (t.kind === "Intrinsic") {
      if (t.name === "void") {
        return "void";
      } else if (t.name === "never") {
        return "never";
      }
    }

    if (isIntrinsic(program, t)) {
      const intrinsicName = getIntrinsicModelName(program, t);

      if (intrinsicName === "Map") {
        let [kT, vT] = (t as ModelType).templateArguments!;
        return `{ [k: ${convertToTypeScript(kT)}]: ${convertToTypeScript(vT)}}`;
      }

      return (
        (
          {
            int8: "number",
            int16: "number",
            int32: "number",
            int64: "number",
            uint8: "number",
            uint16: "number",
            uint32: "number",
            uint64: "number",
            float32: "number",
            float64: "number",
            null: "null",
            boolean: "boolean",
            string: "string",
            bytes: "Uint8Array",
          } as Record<IntrinsicModelName, string | undefined>
        )[intrinsicName] ??
        (() => {
          throw new Error(
            "No TypeScript type for CADL intrinsic:" + t.toString()
          );
        })()
      );
    }

    switch (t.kind) {
      case "String":
        return `"${t.value}"`;
      case "Number":
        return t.value.toString();
      case "Array":
        return `${convertToTypeScript(t.elementType)}[]`;
      case "Model":
        cachedTypeScriptTypeNames.set(t, t.name ?? preferredAlternativeName);
        return addInterface(t, preferredAlternativeName);
      case "Enum":
        cachedTypeScriptTypeNames.set(t, t.name);
        return addEnum(t);
      case "Union":
        return [...t.variants.values()]
          .map((e) => convertToTypeScript(e.type))
          .join(" | ");
      default:
        throw new Error("Unknown type " + t.kind);
    }
  }

  function addInterface(
    tOriginal: ModelType,
    preferredAlternativeName?: string
  ): string {
    if (cachedDeclarations.has(tOriginal))
      return cachedDeclarations.get(tOriginal)!;

    const t = program.checker.getEffectiveModelType(tOriginal);

    const name = t.name !== "" ? t.name : preferredAlternativeName;

    if (!name) {
      throw new Error("Unable to ascertain interface name.");
    }

    const extendsClause =
      t.baseModel !== undefined
        ? ` extends ${convertToTypeScript(t.baseModel)}`
        : "";

    const fields = [...t.properties.values()].map(
      (p) =>
        `\n    ${camelCasify(p.name)}${
          p.optional ? "?" : ""
        }: ${convertToTypeScript(p.type)}`
    );

    const declaration = `\ninterface ${name}${extendsClause} {${fields}}\n`;

    inlineDeclarations += declaration;

    cachedDeclarations.set(tOriginal, name);

    return name;
  }

  function addEnum(e: EnumType): string {
    if (cachedDeclarations.has(e)) return cachedDeclarations.get(e)!;

    const variants = e.members
      .map(({ name, value }) =>
        typeof value === "string"
          ? `"${value}"`
          : typeof value === "number"
          ? value.toString()
          : `"${name}"`
      )
      .join(" | ");

    const declaration = `\ntype ${e.name} = ${variants};\n`;

    inlineDeclarations += declaration;

    cachedDeclarations.set(e, e.name);

    return e.name;
  }
}
