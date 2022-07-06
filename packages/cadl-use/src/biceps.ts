import { addBicepFile } from "cadl-azure-accelerators";

export const BICEPS = {
  textanalytics: () => {
    addBicepFile(
      "language",
      `
param location string
param resourceToken string
param principalId string
param tags object

resource textAnalytics 'Microsoft.CognitiveServices/accounts@2022-03-01' = {
  kind: 'TextAnalytics'
  name: 'textAnalytics\${resourceToken}'
  location: location
  sku: {
    name: 'S'
  }
  tags: tags
  properties: {}
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

output LANGUAGE_ENDPOINT string = 'https://textAnalytics\${resourceToken}.cognitiveservices.azure.com/'
`
    );
  },
} as Record<string, () => void>;
