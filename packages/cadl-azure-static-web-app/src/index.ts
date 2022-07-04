import {
  createDecoratorDefinition,
  DecoratorContext,
  NamespaceType,
  Program,
} from "@cadl-lang/compiler";
import "./lib.js";
import { addBicepFile, addService } from "cadl-azure-accelerators";
const swaKey = Symbol();
const swaDecorator = createDecoratorDefinition({
  name: "@AzureStaticWebApp",
  target: "Namespace",
  args: [],
} as const);

type SwaStateMap = Map<NamespaceType, true>;

export function getSwaState(p: Program): SwaStateMap {
  return p.stateMap(swaKey) as SwaStateMap;
}

export function getSwas(p: Program) {
  const state = getSwaState(p);
  return Array.from(state.keys());
}

export function $AzureStaticWebApp(
  context: DecoratorContext,
  t: NamespaceType
) {
  if (!swaDecorator.validate(context, t, [])) {
    return;
  }
  getSwaState(context.program).set(t, true);
}

export async function $onEmit(p: Program) {
  if (!p.compilerOptions.outputPath) return;
  addService("web", {
    project: "src/web",
    language: "js",
    host: "staticwebapp",
  });
  addBicepFile(
    "swa",
    `
  param location string
  param principalId string = ''
  param resourceToken string
  param tags object
  param APPINSIGHTS_INSTRUMENTATIONKEY string = ''
  param AZURE_KEY_VAULT_ENDPOINT string = ''
  
  resource web 'Microsoft.Web/staticSites@2021-03-01' = {
    name: 'stapp-\${resourceToken}'
    location: location
    tags: union(tags, {
        'azd-service-name': 'web'
      })
    sku: {
      name: 'Free'
      tier: 'Free'
    }
    properties: {
      provider: 'Custom'
    }
    resource staticWebAppSettings 'config@2021-01-15' = {
      name: 'appsettings'
      properties: {
        APPINSIGHTS_INSTRUMENTATIONKEY: APPINSIGHTS_INSTRUMENTATIONKEY
        AZURE_KEY_VAULT_ENDPOINT: AZURE_KEY_VAULT_ENDPOINT
      }
    }
  
  }
  
  output WEB_URI string = 'https://\${web.properties.defaultHostname}'
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
    ]
  );
}
