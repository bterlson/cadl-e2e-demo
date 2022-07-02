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

const biceps: {name: string, contents: string, params: { key: string, value: string }[]}[] = []

export function addBicepFile(name: string, contents: string, params: { key: string, value: string }[] = []) {
  biceps.push({ name, contents, params });
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

interface SecretDescription {
  value: string;
  params: string[]
}
const secrets: Record<string, SecretDescription> = {};
export function addSecret(name: string, value: string, params: string[]=[]) {
  secrets[name] = { value, params };
}

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  const infraDir = path.join(p.compilerOptions.outputPath, "infra");
  await mkdir(infraDir, { recursive: true });

  addBicepFile('keyvault', keyvaultBicep(), keyvaultParams());

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

function keyvaultBicep() {
  return `
  param location string
  param principalId string = ''
  param resourceToken string
  param tags object
  ${keyvaultParams().map(v => `param ${v.key} string`).join("\n")}

  resource keyVault 'Microsoft.KeyVault/vaults@2019-09-01' = {
    name: 'keyvault\${resourceToken}'
    location: location
    tags: tags
    properties: {
      tenantId: subscription().tenantId
      sku: {
        family: 'A'
        name: 'standard'
      }
      accessPolicies: concat([
        ], !empty(principalId) ? [
          {
            objectId: principalId
            permissions: {
              secrets: [
                'get'
                'list'
              ]
            }
            tenantId: subscription().tenantId
          }
        ] : [])
    }
  
    ${keyvaultSecrets()}
  }
  `
}

function keyvaultSecrets() {
  let resources = '';

  for(const [key, value] of Object.entries(secrets)) {
    resources += `
      resource ${key} 'secrets' = {
        name: '${key}'
        properties: {
          value: ${value.value}
        }
      }
    `
  }
  

  return resources;
}

function keyvaultParams() {
  return Object.values(secrets).flatMap(v => v.params.map(p => ({ key: v.value, value: `${p}.outputs.${v.value}`})));
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
          ${bicep.params.map(v => `${v.key}: ${v.value}`).join("\n")}
        }
      }
      `
  }

  return imports;

}