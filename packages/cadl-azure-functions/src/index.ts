import {
  createDecoratorDefinition,
  DecoratorContext,
  NamespaceType,
  Program,
} from "@cadl-lang/compiler";
import "./lib.js";
import { addBicepFile, addService } from "cadl-azure-accelerators";

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  addService("api", {
    project: "src/api",
    language: "js",
    host: "function",
  });

  addBicepFile(
    "functions",
    `
    param location string
    param principalId string = ''
    param resourceToken string
    param tags object
    param APPINSIGHTS_INSTRUMENTATIONKEY string = ''
    param AZURE_KEY_VAULT_ENDPOINT string = ''
    param WEB_URI string = ''

    resource api 'Microsoft.Web/sites@2021-02-01' = {
      name: 'app-api-\${resourceToken}'
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
              'https://\${WEB_URI}'
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
          APPINSIGHTS_INSTRUMENTATIONKEY: APPINSIGHTS_INSTRUMENTATIONKEY
          AZURE_KEY_VAULT_ENDPOINT: AZURE_KEY_VAULT_ENDPOINT
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
    
  `,
    [
      {
        key: "APPINSIGHTS_INSTRUMENTATIONKEY",
        value: "appinsights.outputs.APPINSIGHTS_INSTRUMENTATIONKEY",
      },
      {
        key: "AZURE_KEY_VAULT_ENDPOINT",
        value: "keyvault.outputs.AZURE_KEY_VAULT_ENDPOINT",
      },
      {
        key: "WEB_URI",
        value: "swa.outputs.WEB_URI",
      },
    ]
  );
}
