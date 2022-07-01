import {
  createDecoratorDefinition,
  DecoratorContext,
  NamespaceType,
  Program,
} from "@cadl-lang/compiler";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import "./lib.js";

const biceps: {name: string, contents: string}[] = []
export function addBicepFile(name: string, contents: string) {
  biceps.push({ name, contents});
}
export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  const infraDir = path.join(p.compilerOptions.outputPath, "infra");
  await mkdir(infraDir, { recursive: true });
  for (const bicep of biceps) {
    await writeFile(path.join(infraDir, bicep.name), bicep.contents);
  }

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

module resources './resources.bicep' = {
  name: 'resources-\${resourceToken}'
  scope: resourceGroup
  params: {
    location: location
    principalId: principalId
    resourceToken: resourceToken
    tags: tags
  }
}

output AZURE_COSMOS_CONNECTION_STRING_KEY string = resources.outputs.AZURE_COSMOS_CONNECTION_STRING_KEY
output AZURE_COSMOS_DATABASE_NAME string = resources.outputs.AZURE_COSMOS_DATABASE_NAME
output AZURE_KEY_VAULT_ENDPOINT string = resources.outputs.AZURE_KEY_VAULT_ENDPOINT
output APPINSIGHTS_INSTRUMENTATIONKEY string = resources.outputs.APPINSIGHTS_INSTRUMENTATIONKEY
output REACT_APP_WEB_BASE_URL string = resources.outputs.WEB_URI
output REACT_APP_API_BASE_URL string = resources.outputs.API_URI
output REACT_APP_APPINSIGHTS_INSTRUMENTATIONKEY string = resources.outputs.APPINSIGHTS_INSTRUMENTATIONKEY
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
  
`)
}
