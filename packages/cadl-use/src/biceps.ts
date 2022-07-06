import { addBicepFile } from "cadl-azure-accelerators";

export const BICEPS = {
  textanalytics: () => {
    addBicepFile(
      "language",
      `
param location string
param resourceToken string
param tags object

resource textAnalytics 'Microsoft.CognitiveServices/accounts@2022-03-01' = {
  kind: 'TextAnalytics'
  name: 'textAnalytics\${resourceToken}'
  location: location
  sku: {
    name: 'S'
  }
  tags: tags
}

output LANGUAGE_ENDPOINT string = 'https://textAnalytics\${resourceToken}.cognitiveservices.azure.com/'

output LANGUAGE_API_KEY string = listKeys(textAnalytics.id, textAnalytics.apiVersion)[0]
`
    );
  },
} as Record<string, () => void>;
