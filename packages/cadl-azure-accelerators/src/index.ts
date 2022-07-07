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
import { EOL } from "os";

const biceps: {
  name: string;
  contents: string;
  params: { key: string; value: string }[];
  skipMainLink: boolean;
}[] = [];

export function addBicepFile(
  name: string,
  contents: string,
  params: { key: string; value: string }[] = [],
  skipMainLink: boolean = false
) {
  biceps.push({ name, contents, params, skipMainLink });
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
  params: string[];
}
const secrets: Record<string, SecretDescription> = {};
export function addSecret(name: string, value: string, params: string[] = []) {
  secrets[name] = { value, params };
}

interface EnvDescription {
  name: string;
  source: "bicepOutput" | "constant";
  value: string;
  moduleName?: string;
}

const env: EnvDescription[] = [];
export function addEnvVar(descriptor: EnvDescription) {
  env.push(descriptor);
}

const envHandlers: ((e: EnvDescription[]) => string)[] = [];
export function handleEnv(cb: (e: EnvDescription[]) => string) {
  envHandlers.push(cb);
}

interface OutputDescription {
  type: string;
  value: string;
}
const outputs: Record<string, OutputDescription> = {};
export function addOutput(name: string, type: string, value: string) {
  outputs[name] = { value, type };
}

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  const infraDir = path.join(p.compilerOptions.outputPath, "infra");
  await mkdir(infraDir, { recursive: true });

  addBicepFile(
    "keyvault",
    keyvaultBicep(),
    keyvaultParams().concat({
      key: "API_PRINCIPAL",
      value: "functions.outputs.API_PRINCIPAL",
    })
  );
  addBicepFile("appInsights", appInsightsBicep());
  addOutput(
    "AZURE_KEY_VAULT_ENDPOINT",
    "string",
    "keyvault.outputs.AZURE_KEY_VAULT_ENDPOINT"
  );
  addOutput(
    "APPINSIGHTS_INSTRUMENTATIONKEY",
    "string",
    "appInsights.outputs.APPINSIGHTS_INSTRUMENTATIONKEY"
  );

  for (const bicep of biceps) {
    await writeFile(path.join(infraDir, bicep.name + ".bicep"), bicep.contents);
  }

  await writeFile(
    path.join(infraDir, "main.parameters.json"),
    `
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
`
  );
  await writeFile(
    path.join(infraDir, "main.bicep"),
    `
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
    ${importEnv()}
    ${Object.entries(outputs)
      .map(([name, { type, value }]) => `output ${name} ${type} = ${value}`)
      .join(EOL)}
`
  );


  await writeFile(
    path.join(infraDir, "env.bicep"),
    envBicep()
  )
  
  await writeFile(
    path.join(p.compilerOptions.outputPath, "azure.yaml"),
    azureYaml()
  );
}

function azureYaml() {
  const yaml: Record<string, any> = { name: "test", services };

  return `
# yaml-language-server: $schema=https://azuresdkreleasepreview.blob.core.windows.net/azd/schema/azure.yaml.json
${stringify(yaml)}
  `;
}

function keyvaultBicep() {
  addEnvVar({
    name: 'AZURE_KEY_VAULT_ENDPOINT',
    source: 'bicepOutput',
    value: 'AZURE_KEY_VAULT_ENDPOINT',
    moduleName: 'keyvault'
  });
  return `
  param location string
  param principalId string = ''
  param resourceToken string
  param tags object
  param API_PRINCIPAL string
  ${keyvaultParams()
    .map((v) => `param ${v.key} string`)
    .join("\n")}

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
          {
            objectId: API_PRINCIPAL
            permissions: {
              secrets: [
                'get'
                'list'
              ]
            }
            tenantId: subscription().tenantId
          }
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

  output AZURE_KEY_VAULT_ENDPOINT string = keyVault.properties.vaultUri
  `;
}

function appInsightsBicep() {
  addEnvVar({
    name: 'APPINSIGHTS_INSTRUMENTATIONKEY',
    source: 'bicepOutput',
    value: 'APPINSIGHTS_INSTRUMENTATIONKEY',
    moduleName: 'appInsights'
  });
  return `
  param resourceToken string
  param location string
  param tags object
  param principalId string = ''
  
  resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
    name: 'appi-\${resourceToken}'
    location: location
    tags: tags
    kind: 'web'
    properties: {
      Application_Type: 'web'
    }
  }
  
  resource appInsightsDashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
    name: 'appid-\${resourceToken}'
    location: location
    tags: tags
    properties: {
      lenses: [
        {
          order: 0
          parts: [
            {
              position: {
                x: 0
                y: 0
                colSpan: 2
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'id'
                    value: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                  }
                  {
                    name: 'Version'
                    value: '1.0'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/AspNetOverviewPinnedPart'
                asset: {
                  idInputName: 'id'
                  type: 'ApplicationInsights'
                }
                defaultMenuItemId: 'overview'
              }
            }
            {
              position: {
                x: 2
                y: 0
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'Version'
                    value: '1.0'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/ProactiveDetectionAsyncPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
                defaultMenuItemId: 'ProactiveDetection'
              }
            }
            {
              position: {
                x: 3
                y: 0
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'ResourceId'
                    value: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/QuickPulseButtonSmallPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
              }
            }
            {
              position: {
                x: 4
                y: 0
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'TimeContext'
                    value: {
                      durationMs: 86400000
                      endTime: null
                      createdTime: '2018-05-04T01:20:33.345Z'
                      isInitialTime: true
                      grain: 1
                      useDashboardTimeRange: false
                    }
                  }
                  {
                    name: 'Version'
                    value: '1.0'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/AvailabilityNavButtonPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
              }
            }
            {
              position: {
                x: 5
                y: 0
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'TimeContext'
                    value: {
                      durationMs: 86400000
                      endTime: null
                      createdTime: '2018-05-08T18:47:35.237Z'
                      isInitialTime: true
                      grain: 1
                      useDashboardTimeRange: false
                    }
                  }
                  {
                    name: 'ConfigurationId'
                    value: '78ce933e-e864-4b05-a27b-71fd55a6afad'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/AppMapButtonPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
              }
            }
            {
              position: {
                x: 0
                y: 1
                colSpan: 3
                rowSpan: 1
              }
              metadata: {
                inputs: []
                type: 'Extension/HubsExtension/PartType/MarkdownPart'
                settings: {
                  content: {
                    settings: {
                      content: '# Usage'
                      title: ''
                      subtitle: ''
                    }
                  }
                }
              }
            }
            {
              position: {
                x: 3
                y: 1
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'TimeContext'
                    value: {
                      durationMs: 86400000
                      endTime: null
                      createdTime: '2018-05-04T01:22:35.782Z'
                      isInitialTime: true
                      grain: 1
                      useDashboardTimeRange: false
                    }
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/UsageUsersOverviewPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
              }
            }
            {
              position: {
                x: 4
                y: 1
                colSpan: 3
                rowSpan: 1
              }
              metadata: {
                inputs: []
                type: 'Extension/HubsExtension/PartType/MarkdownPart'
                settings: {
                  content: {
                    settings: {
                      content: '# Reliability'
                      title: ''
                      subtitle: ''
                    }
                  }
                }
              }
            }
            {
              position: {
                x: 7
                y: 1
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ResourceId'
                    value: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                  }
                  {
                    name: 'DataModel'
                    value: {
                      version: '1.0.0'
                      timeContext: {
                        durationMs: 86400000
                        createdTime: '2018-05-04T23:42:40.072Z'
                        isInitialTime: false
                        grain: 1
                        useDashboardTimeRange: false
                      }
                    }
                    isOptional: true
                  }
                  {
                    name: 'ConfigurationId'
                    value: '8a02f7bf-ac0f-40e1-afe9-f0e72cfee77f'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/CuratedBladeFailuresPinnedPart'
                isAdapter: true
                asset: {
                  idInputName: 'ResourceId'
                  type: 'ApplicationInsights'
                }
                defaultMenuItemId: 'failures'
              }
            }
            {
              position: {
                x: 8
                y: 1
                colSpan: 3
                rowSpan: 1
              }
              metadata: {
                inputs: []
                type: 'Extension/HubsExtension/PartType/MarkdownPart'
                settings: {
                  content: {
                    settings: {
                      content: '# Responsiveness\\r\\n'
                      title: ''
                      subtitle: ''
                    }
                  }
                }
              }
            }
            {
              position: {
                x: 11
                y: 1
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ResourceId'
                    value: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                  }
                  {
                    name: 'DataModel'
                    value: {
                      version: '1.0.0'
                      timeContext: {
                        durationMs: 86400000
                        createdTime: '2018-05-04T23:43:37.804Z'
                        isInitialTime: false
                        grain: 1
                        useDashboardTimeRange: false
                      }
                    }
                    isOptional: true
                  }
                  {
                    name: 'ConfigurationId'
                    value: '2a8ede4f-2bee-4b9c-aed9-2db0e8a01865'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/CuratedBladePerformancePinnedPart'
                isAdapter: true
                asset: {
                  idInputName: 'ResourceId'
                  type: 'ApplicationInsights'
                }
                defaultMenuItemId: 'performance'
              }
            }
            {
              position: {
                x: 12
                y: 1
                colSpan: 3
                rowSpan: 1
              }
              metadata: {
                inputs: []
                type: 'Extension/HubsExtension/PartType/MarkdownPart'
                settings: {
                  content: {
                    settings: {
                      content: '# Browser'
                      title: ''
                      subtitle: ''
                    }
                  }
                }
              }
            }
            {
              position: {
                x: 15
                y: 1
                colSpan: 1
                rowSpan: 1
              }
              metadata: {
                inputs: [
                  {
                    name: 'ComponentId'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'MetricsExplorerJsonDefinitionId'
                    value: 'BrowserPerformanceTimelineMetrics'
                  }
                  {
                    name: 'TimeContext'
                    value: {
                      durationMs: 86400000
                      createdTime: '2018-05-08T12:16:27.534Z'
                      isInitialTime: false
                      grain: 1
                      useDashboardTimeRange: false
                    }
                  }
                  {
                    name: 'CurrentFilter'
                    value: {
                      eventTypes: [
                        4
                        1
                        3
                        5
                        2
                        6
                        13
                      ]
                      typeFacets: {}
                      isPermissive: false
                    }
                  }
                  {
                    name: 'id'
                    value: {
                      Name: appInsights.name
                      SubscriptionId: subscription().subscriptionId
                      ResourceGroup: resourceGroup().name
                    }
                  }
                  {
                    name: 'Version'
                    value: '1.0'
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/AppInsightsExtension/PartType/MetricsExplorerBladePinnedPart'
                asset: {
                  idInputName: 'ComponentId'
                  type: 'ApplicationInsights'
                }
                defaultMenuItemId: 'browser'
              }
            }
            {
              position: {
                x: 0
                y: 2
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'sessions/count'
                            aggregationType: 5
                            namespace: 'microsoft.insights/components/kusto'
                            metricVisualization: {
                              displayName: 'Sessions'
                              color: '#47BDF5'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'users/count'
                            aggregationType: 5
                            namespace: 'microsoft.insights/components/kusto'
                            metricVisualization: {
                              displayName: 'Users'
                              color: '#7E58FF'
                            }
                          }
                        ]
                        title: 'Unique sessions and users'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                        openBladeOnClick: {
                          openBlade: true
                          destinationBlade: {
                            extensionName: 'HubsExtension'
                            bladeName: 'ResourceMenuBlade'
                            parameters: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                              menuid: 'segmentationUsers'
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 4
                y: 2
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'requests/failed'
                            aggregationType: 7
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Failed requests'
                              color: '#EC008C'
                            }
                          }
                        ]
                        title: 'Failed requests'
                        visualization: {
                          chartType: 3
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                        openBladeOnClick: {
                          openBlade: true
                          destinationBlade: {
                            extensionName: 'HubsExtension'
                            bladeName: 'ResourceMenuBlade'
                            parameters: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                              menuid: 'failures'
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 8
                y: 2
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'requests/duration'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Server response time'
                              color: '#00BCF2'
                            }
                          }
                        ]
                        title: 'Server response time'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                        openBladeOnClick: {
                          openBlade: true
                          destinationBlade: {
                            extensionName: 'HubsExtension'
                            bladeName: 'ResourceMenuBlade'
                            parameters: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                              menuid: 'performance'
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 12
                y: 2
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'browserTimings/networkDuration'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Page load network connect time'
                              color: '#7E58FF'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\scription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'browserTimings/processingDuration'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Client processing time'
                              color: '#44F1C8'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'browserTimings/sendDuration'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Send request time'
                              color: '#EB9371'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'browserTimings/receiveDuration'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Receiving response time'
                              color: '#0672F1'
                            }
                          }
                        ]
                        title: 'Average page load time breakdown'
                        visualization: {
                          chartType: 3
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 0
                y: 5
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'availabilityResults/availabilityPercentage'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Availability'
                              color: '#47BDF5'
                            }
                          }
                        ]
                        title: 'Average availability'
                        visualization: {
                          chartType: 3
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                        openBladeOnClick: {
                          openBlade: true
                          destinationBlade: {
                            extensionName: 'HubsExtension'
                            bladeName: 'ResourceMenuBlade'
                            parameters: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                              menuid: 'availability'
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 4
                y: 5
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'exceptions/server'
                            aggregationType: 7
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Server exceptions'
                              color: '#47BDF5'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'dependencies/failed'
                            aggregationType: 7
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Dependency failures'
                              color: '#7E58FF'
                            }
                          }
                        ]
                        title: 'Server exceptions and Dependency failures'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 8
                y: 5
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'performanceCounters/processorCpuPercentage'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Processor time'
                              color: '#47BDF5'
                            }
                          }
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'performanceCounters/processCpuPercentage'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Process CPU'
                              color: '#7E58FF'
                            }
                          }
                        ]
                        title: 'Average processor and process CPU utilization'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 12
                y: 5
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'exceptions/browser'
                            aggregationType: 7
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Browser exceptions'
                              color: '#47BDF5'
                            }
                          }
                        ]
                        title: 'Browser exceptions'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 0
                y: 8
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'availabilityResults/count'
                            aggregationType: 7
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Availability test results count'
                              color: '#47BDF5'
                            }
                          }
                        ]
                        title: 'Availability test results count'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 4
                y: 8
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'performanceCounters/processIOBytesPerSecond'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Process IO rate'
                              color: '#47BDF5'
                            }
                          }
                        ]
                        title: 'Average process I/O rate'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
            {
              position: {
                x: 8
                y: 8
                colSpan: 4
                rowSpan: 3
              }
              metadata: {
                inputs: [
                  {
                    name: 'options'
                    value: {
                      chart: {
                        metrics: [
                          {
                            resourceMetadata: {
                              id: '/subscriptions/\${subscription().subscriptionId}/resourceGroups/\${resourceGroup().name}/providers/Microsoft.Insights/components/\${appInsights.name}'
                            }
                            name: 'performanceCounters/memoryAvailableBytes'
                            aggregationType: 4
                            namespace: 'microsoft.insights/components'
                            metricVisualization: {
                              displayName: 'Available memory'
                              color: '#47BDF5'
                            }
                          }
                        ]
                        title: 'Average available memory'
                        visualization: {
                          chartType: 2
                          legendVisualization: {
                            isVisible: true
                            position: 2
                            hideSubtitle: false
                          }
                          axisVisualization: {
                            x: {
                              isVisible: true
                              axisType: 2
                            }
                            y: {
                              isVisible: true
                              axisType: 1
                            }
                          }
                        }
                      }
                    }
                  }
                  {
                    name: 'sharedTimeRange'
                    isOptional: true
                  }
                ]
                #disable-next-line BCP036
                type: 'Extension/HubsExtension/PartType/MonitorChartPart'
                settings: {}
              }
            }
          ]
        }
      ]
    }
  }
  
  output APPINSIGHTS_INSTRUMENTATIONKEY string = appInsights.properties.InstrumentationKey
  output APPINSIGHTS_CONNECTION_STRING string = appInsights.properties.ConnectionString
  
  `;
}

function keyvaultSecrets() {
  let resources = "";

  for (const [key, value] of Object.entries(secrets)) {
    resources += `
      resource ${key} 'secrets' = {
        name: '${key}'
        properties: {
          value: ${value.value}
        }
      }
    `;
  }

  return resources;
}

function keyvaultParams() {
  return Object.values(secrets).flatMap((v) =>
    v.params.map((p) => ({ key: v.value, value: `${p}.outputs.${v.value}` }))
  );
}

function importBiceps() {
  let imports = "";
  for (const bicep of biceps) {
    if (bicep.skipMainLink) continue;
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
          ${bicep.params.map((v) => `${v.key}: ${v.value}`).join("\n")}
        }
      }
      `;
  }

  return imports;
}

function importEnv() {
  if (env.length === 0) return '';
  return `module env './env.bicep' = {
    name: 'env-\${resourceToken}'
    scope: resourceGroup
    params: {
      location: location
      principalId: principalId
      resourceToken: resourceToken
      tags: tags
      ${getEnvModuleParams()}
    }
  }`;
}

function envBicep() {
  return `
    param location string
    param principalId string = ''
    param resourceToken string
    param tags object
    ${getEnvModuleParamDecls()}
    ${envHandlers.map(h => h(env)).join("\n")}
  `
}

function getEnvModuleParams() {
  let params: string[] = [];
  for (const descriptor of env) {
    if (descriptor.source === "bicepOutput") {
      params.push(
        `${descriptor.name}: ${descriptor.moduleName!}.outputs.${descriptor.value}`
      );
    }
  }

  return params.join("\n");
}

function getEnvModuleParamDecls() {
  let params: string[] = [];
  for (const [name, descriptor] of Object.entries(env)) {
    if (descriptor.source === "bicepOutput") {
      params.push(
        `param ${descriptor.name} string`
      );
    }
  }

  return params.join("\n");
}
