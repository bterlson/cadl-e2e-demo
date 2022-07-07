import {
  addBicepFile,
  addOutput,
  addSecret,
  addService,
} from "cadl-azure-accelerators";

export const BICEPS = {
  textanalytics: () => {
    addBicepFile(
      "language",
      `
param location string
param resourceToken string
param principalId string
param tags object

var accountName = 'textAnalytics\${resourceToken}'

resource textAnalytics 'Microsoft.CognitiveServices/accounts@2022-03-01' = {
  kind: 'TextAnalytics'
  name: accountName
  location: location
  sku: {
    name: 'S'
  }
  tags: tags
  properties: {
    customSubDomainName: accountName
  }
}

resource cognitiveServicesUser 'Microsoft.Authorization/roleDefinition@2018-01-01-preview' existing = {
  scope: subscription()
  name: 'a97b65f3-24c7-4388-baec-2e87135dc908'
}

resource rbacAssignment 'Microsoft.Authorization/roleAssignments@2020-04-01-preview' = {
  name: guid(textAnalytics.id, principalId, cognitiveServicesUser.id)
  properties: {
    roleDefinitionId: cognitiveServicesUser.id
    principalId: principalId
    principalType: 'User'
  }
}

output LANGUAGE_ENDPOINT string = 'https://\${accountName}.cognitiveservices.azure.com/'
`
    );
    addOutput(
      "LANGUAGE_ENDPOINT",
      "string",
      "language.outputs.LANGUAGE_ENDPOINT"
    );
  },
} as Record<string, () => void>;
