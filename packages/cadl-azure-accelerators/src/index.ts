import {
  createDecoratorDefinition,
  DecoratorContext,
  NamespaceType,
  Program,
} from "@cadl-lang/compiler";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { stringify } from "yaml";

import "./lib.js";

const biceps: {name: string, contents: string}[] = []

export function addBicepFile(name: string, contents: string) {
  biceps.push({ name, contents});
}

interface ServiceDescription {
  project: string;
  resourceName?: string;
  host?: string;
  language?: string;
  moduleName?: string;
  dist?: string;
}

const services: Record<string, ServiceDescription> = {};

export function addService(name: string, contents: ServiceDescription) {
  services[name] = contents;
}

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  const infraDir = path.join(p.compilerOptions.outputPath, "infra");
  await mkdir(infraDir, { recursive: true });
  for (const bicep of biceps) {
    await writeFile(path.join(infraDir, bicep.name + ".bicep"), bicep.contents);
  }

  await writeFile(path.join(infraDir, "main.parameters.json"), `
  {
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
      "name": {
        "value": "\${AZURE_ENV_NAME}"
      },
      "location": {
        "value": "\${AZURE_LOCATION}"
      },
      "principalId": {
        "value": "\${AZURE_PRINCIPAL_ID}"
      }
    }
  }
`)
  await writeFile(path.join(infraDir, "main.bicep"), `
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the the environment which is used to generate a short unqiue hash used in all resources.')
param name string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Id of the user or app to assign application roles')
param principalId string = ''

resource resourceGroup 'Microsoft.Resources/resourceGroups@2020-06-01' = {
  name: '\${name}-rg'
  location: location
  tags: tags
}

var resourceToken = toLower(uniqueString(subscription().id, name, location))
var tags = {
  'azd-env-name': name
}

${importBiceps()}
`)

  await writeFile(path.join(p.compilerOptions.outputPath, "azure.yaml"), azureYaml());
}

function azureYaml() {
  const yaml: Record<string, any> = { name: "test", services };

  return `
# yaml-language-server: $schema=https://azuresdkreleasepreview.blob.core.windows.net/azd/schema/azure.yaml.json
${stringify(yaml)}
  `
}
function importBiceps() {
  let imports = '';
  for (const bicep of biceps) {
    // todo: need to name these resources better.
    imports += `
      module ${bicep.name} './${bicep.name}.bicep' = {
        name: '${bicep.name}-\${resourceToken}'
        scope: resourceGroup
        params: {
          location: location
          principalId: principalId
          resourceToken: resourceToken
          tags: tags
        }
      }
      `
  }

  return imports;

}