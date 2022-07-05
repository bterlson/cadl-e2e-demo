import {
  Program,
  EmitOptionsFor,
  navigateProgram,
  Type,
  DecoratorContext,
  ModelType,
  ModelTypeProperty,
  ArrayType,
  getIntrinsicModelName,
  createDecoratorDefinition,
  StringLiteralType,
  isKey,
} from "@cadl-lang/compiler";
import { DataStoreLibrary } from "./lib.js";
import { mkdir, writeFile } from "fs/promises";
import { format } from "prettier";
import { addBicepFile, addSecret } from "cadl-azure-accelerators";

import * as path from "path";

interface DataStoreEmitterOptions {
  outputDir: string;
}

const storeKey = Symbol();
const storeDecorator = createDecoratorDefinition({
  name: "@store",
  target: "Model",
  args: [
    { kind: "String", optional: false },
    { kind: "String", optional: true },
  ],
} as const);

type StoreStateMap = Map<
  ModelType,
  { databaseName: string; collectionName: string | undefined }
>;

function getStoreState(p: Program): StoreStateMap {
  return p.stateMap(storeKey) as StoreStateMap;
}

export function $store(
  context: DecoratorContext,
  t: ModelType,
  databaseName: string,
  collectionName: string
) {
  if (!storeDecorator.validate(context, t, [databaseName, collectionName])) {
    return;
  }
  getStoreState(context.program).set(t, { databaseName, collectionName });
}

export async function $onEmit(
  p: Program,
  options: EmitOptionsFor<DataStoreLibrary>
) {
  if (!p.compilerOptions.outputPath) return;
  const outputDir = path.join(p.compilerOptions.outputPath, "store");
  const emitter = createTsEmitter(p, { outputDir });
  emitter.emit();

  addBicepFile("cosmos", `
  param location string
  param principalId string = ''
  param resourceToken string
  param tags object
  resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2021-04-15' = {
    name: 'cosmos-\${resourceToken}'
    kind: 'GlobalDocumentDB'
    location: location
    tags: tags
    properties: {
      consistencyPolicy: {
        defaultConsistencyLevel: 'Session'
      }
      locations: [
        {
          locationName: location
          failoverPriority: 0
          isZoneRedundant: false
        }
      ]
      databaseAccountOfferType: 'Standard'
      enableAutomaticFailover: false
      enableMultipleWriteLocations: false
      capabilities: [
        {
          name: 'EnableServerless'
        }
      ]
    }
  }

  output cosmosConnectionStringValue string = cosmos.listConnectionStrings().connectionStrings[0].connectionString
`)
  addSecret("cosmosConnectionString", "cosmosConnectionStringValue", ["cosmos"]);
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

function createTsEmitter(p: Program, options: DataStoreEmitterOptions) {
  let typeDecls: string[] = [];
  const knownTypes = new Map<Type, string>();
  let entityStoreCode = `
  class EntityStore<T, TKeyField extends string = never> {
    private client: CosmosClient;
    private databaseId: string;
    private collectionId: string;
    private container!: Container;
    private database!: Database;
    constructor(client: CosmosClient, databaseId: string, collectionId: string) {
      this.client = client;
      this.databaseId = databaseId;
      this.collectionId = collectionId;
    }
  
    async init() {
      const { database } = await this.client.databases.createIfNotExists({
        id: this.databaseId,
      });
      const { container } = await database.containers.createIfNotExists({
        id: this.collectionId,
      });
      this.database = database;
      this.container = container;
    }
  
    async get(id: string): Promise<(T & Resource) | undefined>  {
      const { resource } = await this.container.item(id).read();
      return resource;
    }

    async find(query: string): Promise<(T & Resource)[]> {
      const { resources } = await this.container.items.query(query).fetchAll();
      return resources;
    }

    async findWhere(predicate: string): Promise<(T & Resource)[]> {
      const { resources } = await this.container.items.query(\`select * from \${this.collectionId} where \${predicate}\`).fetchAll();
      return resources;
    }

    async findAll(): Promise<(T & Resource)[]> {
      return this.find(\`select * from \${this.collectionId}\`);
    }

    async add(item: Omit<T, TKeyField>): Promise<T & Resource> {
      const { resource } = await this.container.items.create(item);
      return resource! as T & Resource;
    }

    async update(id: string, updatedItem: Omit<T, TKeyField>): Promise<T & Resource> {
      const { resource } = await this.container.item(id).replace(updatedItem);
      return resource! as T & Resource;
    }

    async delete(id: string): Promise<void> {
      await this.container.item(id).delete();
    }
  }`;
  let storeCode = "";

  return {
    emit,
  };

  async function emit() {
    await mkdir(options.outputDir, { recursive: true });
    emitStoreCode();

    const contents = `
    import { Container, CosmosClient, Database, Resource } from "@azure/cosmos";

    ${typeDecls.join("\n")}
    ${entityStoreCode}
    ${storeCode}
    `;

    await writeFile(
      path.join(options.outputDir, "data-store.ts"),
      format(contents, { parser: "typescript" })
    );
  }

  function emitStoreCode() {
    storeCode = `
    export class DataStore {
      private client: CosmosClient;
      ${getDataStorePublicFields()}
      constructor(connectionString: string) {
        this.client = new CosmosClient(connectionString);
        ${getDataStoreConstructorCode()}
      }
    
      async init() {
        ${getDataStoreInitCode()}
      }
    }
    `;
  }
  function getDataStorePublicFields() {
    let fields: string[] = [];
    for (const [model, info] of getStoreState(p)) {
      const name = model.name;
      fields.push(`public ${name}: EntityStore<${getTypeReference(model)}, ${getKeyFields(model)}>;`);
    }

    return fields.join("\n");
  }
  function getDataStoreConstructorCode() {
    let code = "";
    for (const [model, info] of getStoreState(p)) {
      const name = model.name;
      code += `this.${name} = new EntityStore<${getTypeReference(
        model
      )}, ${getKeyFields(model)}>(this.client, "${info.databaseName}", "${
        info.collectionName ?? name
      }");\n`;
    }

    return code;
  }
  
  function getKeyFields(model: ModelType) {
    for (const prop of model.properties.values()) {
      if (isKey(p, prop)) {
        return `"${prop.name}"`;
      }
    }

    return 'never';
  }

  function getDataStoreInitCode() {
    const inits: string[] = [];
    for (const [model, info] of getStoreState(p)) {
      const name = model.name;
      inits.push(`this.${name}.init()`);
    }
    return `await Promise.all([${inits.join(", ")}]);`;
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
      default:
        // todo: diagnostic
        return "{}";
    }
  }

  function generateArrayType(type: ArrayType) {
    return `${getTypeReference(type.elementType)}[]`;
  }

  function generateModelType(type: ModelType): string {
    const intrinsicName = getIntrinsicModelName(p, type);
    if (intrinsicName) {
      if (!instrinsicNameToTSType.has(intrinsicName)) {
        throw new Error("Unknown intrinsic type " + intrinsicName);
      }

      return instrinsicNameToTSType.get(intrinsicName)!;
    }

    const props: string[] = [];

    for (const prop of type.properties.values()) {
      props.push(
        `${prop.name}${prop.optional ? "?" : ""}: ${getTypeReference(
          prop.type
        )}`
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

  function getModelProperty(model: ModelTypeProperty) {}
}
