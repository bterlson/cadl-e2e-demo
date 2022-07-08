import {
  createDecoratorDefinition,
  DecoratorContext,
  InterfaceType,
  NamespaceType,
  OperationType,
  Program,
  getIntrinsicModelName,
  Type,
  ModelType,
  ArrayType,
} from "@cadl-lang/compiler";
import {
  getAllRoutes,
  getHeaderFieldName,
  OperationDetails,
} from "@cadl-lang/rest/http";
import "./lib.js";
import path from "path";
import { writeFile, mkdir } from "fs/promises";
import {
  addBicepFile,
  addOutput,
  addService,
  handleEnv,
} from "cadl-azure-accelerators";

const functionKey = Symbol();
const functionDecorator = createDecoratorDefinition({
  name: "@AzureFunction",
  target: ["Namespace", "Interface", "Operation"],
  args: [],
} as any); // hopefully this any cast isn't needed in latest cadl?

type FunctionStateMap = Map<
  NamespaceType | InterfaceType | OperationType,
  true
>;

export function getFunctionState(p: Program): FunctionStateMap {
  return p.stateMap(functionKey) as FunctionStateMap;
}

export function isAzureFunction(
  p: Program,
  t: NamespaceType | InterfaceType | OperationType
) {
  return !!getFunctionState(p).get(t);
}

export function $AzureFunction(context: DecoratorContext, t: NamespaceType) {
  if (!functionDecorator.validate(context, t, [])) {
    return;
  }
  getFunctionState(context.program).set(t, true);
}

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;

  const e = createFunctionsEmitter(p, p.compilerOptions.outputPath);
  await e.emit();
}

function createFunctionsEmitter(program: Program, basePath: string) {
  const apiPath = path.join(basePath, "api");

  return {
    emit,
  };

  async function emit() {
    emitService();
    emitFunctionsBicep();
    await emitFunctionApp();
    await emitServerSideHost();
  }

  async function emitFunctionApp() {
    await mkdir(apiPath, { recursive: true });
    await emitHostJson();
    const [routes] = getAllRoutes(program);

    for (const operation of routes) {
      if (isInsideFunctionApp(operation)) {
        await emitFunction(operation);
      }
    }
  }

  function isInsideFunctionApp(operation: OperationDetails) {
    if (isAzureFunction(program, operation.operation)) {
      return true;
    }
    let container: NamespaceType | InterfaceType | undefined =
      operation.container;
    while (container) {
      if (isAzureFunction(program, container)) {
        return true;
      }

      container = container.namespace;
    }

    return false;
  }

  async function emitFunction(operation: OperationDetails) {
    const functionDir = path.join(apiPath, operation.operation.name);
    await mkdir(functionDir, { recursive: true });

    const fnsJson = {
      bindings: [
        {
          authLevel: "anonymous",
          type: "httpTrigger",
          direction: "in",
          name: "req",
          methods: [operation.verb],
          route: operation.path.slice(1), // slice off slash.
        },
        {
          type: "http",
          direction: "out",
          name: "res",
        },
      ],
      scriptFile: `../dist/${operation.operation.name}/index.js`,
    };
    let functionJsonCode = JSON.stringify(fnsJson);

    await writeFile(path.join(functionDir, "function.json"), functionJsonCode);

    let [argMarshalling, params] = getArgMarshalling(operation);
    //index.ts code generator
    // the import of index.js is basically a hack, and should be fixed.
    let indexCode = `
    import { AzureFunction, Context, HttpRequest } from "@azure/functions";
    import { Host } from "../Host.js";
    import "../index.js";

    const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
       ${argMarshalling}
       const _result = await Host.${operation.operation.name}(${params.join(
      ","
    )});
       ${getReturnValueMarshalling(operation)}
    };
    export default httpTrigger;`;

    await writeFile(path.join(functionDir, "index.ts"), indexCode);
  }

  function getArgMarshalling(operation: OperationDetails): [string, string[]] {
    let marshallingCode = "";
    let params: string[] = [];
    // get header, query, and path params
    for (const param of operation.parameters.parameters) {
      const cadlParam = param.param;
      const paramType = param.param.type;

      switch (param.type) {
        case "query":
          if (!cadlParam.optional) {
            marshallingCode += `if (req.query.${param.name} === undefined) {
              context.res = {
                status: 500,
                body: "Missing required query parameter ${param.name}"
              }
              return;
            }`;
          }

          if (isNumber(paramType)) {
            if (cadlParam.optional) {
              marshallingCode += `const ${param.name} = req.query.${param.name} ? Number(req.query.${param.name}) : undefined;`;
            } else {
              marshallingCode += `const ${param.name} = Number(req.query.${param.name}!);`;
            }
          } else if (isString(paramType)) {
            marshallingCode += `const ${param.name} = req.query.${param.name};`;
          } else if (isBoolean(paramType)) {
            marshallingCode += `const ${param.name} = req.query.${param.name} === "true";`;
          } else {
            throw new Error("unsupported query string type");
          }
          params.push(param.name);
          break;
        case "header":
          const headerInfo = getHeaderFieldName(program, cadlParam);
          if (!cadlParam.optional) {
            marshallingCode += `if (req.headers["${headerInfo}"] === undefined) {
              context.res = {
                status: 500,
                body: "Missing required query parameter ${headerInfo}"
              }
              return;
            }`;
          }

          if (isNumber(paramType)) {
            if (cadlParam.optional) {
              marshallingCode += `const ${param.name} = req.headers["${headerInfo}"] ? Number(req.headers["${headerInfo}"]) : undefined;`;
            } else {
              marshallingCode += `const ${param.name} = Number(req.headers["${headerInfo}"]);`;
            }
          } else if (isString(paramType)) {
            marshallingCode += `const ${param.name} = req.headers["${headerInfo}"];`;
          } else if (isBoolean(paramType)) {
            marshallingCode += `const ${param.name} = req.headers["${headerInfo}"] === "true";`;
          } else {
            throw new Error("unsupported header type");
          }
          params.push(param.name);
          break;
        case "path":
          marshallingCode += `const ${param.name} = context.bindingData.${param.name};`;
          params.push(param.name);
          break;
      }
    }

    // todo: the body parameter should probably occur whereever it is declared in the cadl,
    // rather than last.

    // get body param
    if (operation.parameters.body) {
      marshallingCode += `const ${operation.parameters.body.name} = req.body;`;
      params.push(operation.parameters.body.name);
    }
    return [marshallingCode, params];
  }

  function getReturnValueMarshalling(op: OperationDetails): string {
    // just a stub that assumes OkResponse<T> for now.
    return `context.res = {
      status: _result.statusCode,
      body: (_result as any).body
    } `;
  }

  async function emitServerSideHost() {
    const interfaceEmitter = createTSInterfaceEmitter(program);

    const [routes] = getAllRoutes(program);
    let hostHooks: string[] = [];

    for (const operation of routes) {
      if (isInsideFunctionApp(operation)) {
        hostHooks.push(
          `${operation.operation.name}: ${interfaceEmitter.getTypeReference(
            operation.operation
          )}`
        );
      }
    }

    const serverSideHost = `
      interface HostHooks {
        ${hostHooks.join("\n")}
      }

      ${interfaceEmitter.getTypeDecls().join("\n")}

      export const Host: HostHooks = {} as any;
    `;

    await writeFile(path.join(apiPath, "Host.ts"), serverSideHost);
  }

  async function emitHostJson() {
    let hostCode = `
    {
      "version": "2.0",
      "logging": {
        "applicationInsights": {
          "samplingSettings": {
            "isEnabled": true,
            "excludedTypes": "Request"
          }
        }
      },
      "extensionBundle": {
        "id": "Microsoft.Azure.Functions.ExtensionBundle",
        "version": "[2.*, 3.0.0)"
      }
    }
    `;

    await writeFile(path.join(apiPath, "host.json"), hostCode);
  }

  function emitService() {
    addService("api", {
      project: "src/api",
      language: "js",
      host: "function",
    });
  }

  function emitFunctionsBicep() {
    const name = "app-api-${resourceToken}";
    addBicepFile(
      "functions",
      `
      param location string
      param principalId string = ''
      param resourceToken string
      param tags object
      param WEB_URI string = ''
  
      resource api 'Microsoft.Web/sites@2021-02-01' = {
        name: '${name}'
        location: location
        tags: union(tags, {
            'azd-service-name': 'api'
          })
        kind: 'functionapp,linux'
        properties: {
          serverFarmId: appServicePlan.id
          siteConfig: {
            numberOfWorkers: 1
            linuxFxVersion: 'NODE|16'
            alwaysOn: false
            functionAppScaleLimit: 200
            minimumElasticInstanceCount: 0
            ftpsState: 'FtpsOnly'
            use32BitWorkerProcess: false
            cors: {
              allowedOrigins: [
                'https://ms.portal.azure.com'
                '\${WEB_URI}'
              ]
            }
          }
          clientAffinityEnabled: false
          httpsOnly: true
        }
      
        identity: {
          type: 'SystemAssigned'
        }
      
        resource appSettings 'config' = {
          name: 'appsettings'
          properties: {
            'AzureWebJobsStorage': 'DefaultEndpointsProtocol=https;AccountName=\${storage.name};EndpointSuffix=\${environment().suffixes.storage};AccountKey=\${storage.listKeys().keys[0].value}'
            'FUNCTIONS_EXTENSION_VERSION': '~4'
            'FUNCTIONS_WORKER_RUNTIME': 'node'
            'SCM_DO_BUILD_DURING_DEPLOYMENT': 'true'
          }
        }
      
        resource logs 'config' = {
          name: 'logs'
          properties: {
            applicationLogs: {
              fileSystem: {
                level: 'Verbose'
              }
            }
            detailedErrorMessages: {
              enabled: true
            }
            failedRequestsTracing: {
              enabled: true
            }
            httpLogs: {
              fileSystem: {
                enabled: true
                retentionInDays: 1
                retentionInMb: 35
              }
            }
          }
        }
      }
      
      resource appServicePlan 'Microsoft.Web/serverfarms@2021-03-01' = {
        name: 'plan-\${resourceToken}'
        location: location
        tags: tags
        sku: {
          name: 'Y1'
          tier: 'Dynamic'
          size: 'Y1'
          family: 'Y'
        }
        kind: 'functionapp'
        properties: {
          reserved: true
        }
      }
  
      resource storage 'Microsoft.Storage/storageAccounts@2021-09-01' = {
        name: 'stor\${resourceToken}'
        location: location
        tags: tags
        kind: 'StorageV2'
        sku: {
          name: 'Standard_LRS'
        }
        properties: {
          minimumTlsVersion: 'TLS1_2'
          allowBlobPublicAccess: false
          networkAcls: {
            bypass: 'AzureServices'
            defaultAction: 'Allow'
          }
        }
      }
      
      output API_PRINCIPAL string = api.identity.principalId
      output FUNCTION_ENDPOINT string = api.properties.defaultHostName
    `,
      [
        {
          key: "WEB_URI",
          value: "swa.outputs.WEB_URI",
        },
      ]
    );

    addOutput("API_ENDPOINT", "string", "functions.outputs.FUNCTION_ENDPOINT");

    addBicepFile(
      "getFnEnv",
      `
    param resourceToken string
    output fnAppSettings object = list('Microsoft.Web/sites/${name}/config/appsettings', '2020-12-01').properties    
    `,
      [],
      true
    );

    handleEnv(
      (env) => `
      module getFnEnv './getFnEnv.bicep' = {
        name: 'getFnEnv'
        params: {
          resourceToken: resourceToken
        }
      }
      
      resource fnConfig 'Microsoft.Web/sites/config@2020-12-01' = {
        name: '${name}/appsettings'
        properties: union(getFnEnv.outputs.fnAppSettings, {
            ${env.map((e) => `${e.name}: ${e.value}`).join("\n")}
          })
      }    
    `
    );
  }

  function isNumber(type: Type) {
    const t = getIntrinsicModelName(program, type);
    if (!t) return false;
    return ["int16", "int32", "float16", "float32"].includes(t);
  }

  function isString(type: Type) {
    return getIntrinsicModelName(program, type) === "string";
  }

  function isBoolean(type: Type) {
    return getIntrinsicModelName(program, type) === "boolean";
  }
}

const instrinsicNameToTSType = new Map<string, string>([
  ["string", "string"],
  ["int32", "number"],
  ["int16", "number"],
  ["float16", "number"],
  ["float32", "number"],
  ["int64", "bigint"],
  ["boolean", "boolean"],
]);

function createTSInterfaceEmitter(program: Program) {
  let typeDecls: string[] = [];
  const knownTypes = new Map<Type, string>();

  return {
    getTypeReference,
    getTypeDecls,
  };

  function getTypeDecls() {
    return typeDecls;
  }

  function getTypeReference(type: Type): string {
    if (knownTypes.has(type)) {
      return knownTypes.get(type)!;
    }

    switch (type.kind) {
      case "Model":
        return generateModelType(type);
      case "Array":
        return generateArrayType(type);
      case "Number":
        return type.value.toString();
      case "String":
        return `"${type.value.toString()}"`;
      case "Union":
        return type.options.map(getTypeReference).join("|");
      case "Operation":
        return generateOperationType(type);
      default:
        // todo: diagnostic
        return "{}";
    }
  }

  function generateOperationType(type: OperationType): string {
    const ref = type.name;
    // todo: this is always async, but to generalize it should not be the case.
    let str = `interface ${type.name} {
      (${generateOperationParameters(type)}): Promise<${getTypeReference(
      type.returnType
    )}>
    }`;

    typeDecls.push(str);
    knownTypes.set(type, ref);

    return ref;
  }

  function generateOperationParameters(type: OperationType): string {
    let params: string[] = [];
    for (const param of type.parameters.properties.values()) {
      params.push(
        `${param.name}${param.optional ? "?" : ""}: ${getTypeReference(
          param.type
        )}`
      );
    }

    return params.join(", ");
  }

  function generateArrayType(type: ArrayType) {
    return `${getTypeReference(type.elementType)}[]`;
  }

  function generateModelType(type: ModelType): string {
    const intrinsicName = getIntrinsicModelName(program, type);
    if (intrinsicName) {
      if (!instrinsicNameToTSType.has(intrinsicName)) {
        throw new Error("Unknown intrinsic type " + intrinsicName);
      }

      return instrinsicNameToTSType.get(intrinsicName)!;
    }

    const props: string[] = [];

    for (const prop of type.properties.values()) {
      // why is this called _ :(
      const name = prop.name === "_" ? "statusCode" : prop.name;
      props.push(
        `${name}${prop.optional ? "?" : ""}: ${getTypeReference(prop.type)}`
      );
    }

    const typeRef = getModelDeclarationName(type);

    const typeStr = `interface ${typeRef} {
      ${props.join(",")}
    }`;

    typeDecls.push(typeStr);

    knownTypes.set(type, typeRef);

    return typeRef;
  }

  function getModelDeclarationName(type: ModelType): string {
    if (
      type.templateArguments === undefined ||
      type.templateArguments.length === 0
    ) {
      return type.name;
    }

    // todo: this probably needs to be a lot more robust
    const parameterNames = type.templateArguments.map((t) => {
      switch (t.kind) {
        case "Model":
          return getModelDeclarationName(t);
        case "Array":
          if (t.elementType.kind === "Model") {
            return getModelDeclarationName(t.elementType) + "Array";
          }
        // fallthrough
        default:
          throw new Error(
            "Can't get a name for non-model type used to instantiate a model template"
          );
      }
    });

    return type.name + parameterNames.join("");
  }
}
