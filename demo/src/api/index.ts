import { Host } from "./Host.js";
import { DataStore } from "./store/data-store.js";
import { analyzeSentiment } from "./use/analyzeSentiment.js";
import { getSecret } from "./use/getSecret.js";

import { DefaultAzureCredential } from "@azure/identity";

const keyVaultUrl = process.env.AZURE_KEY_VAULT_ENDPOINT!;
const credential = new DefaultAzureCredential();

const cosmosKey = await getSecret(
  keyVaultUrl,
  credential,
  "cosmosConnectionString",
  "7.3"
);

const store = new DataStore(cosmosKey.value!);
await store.init();

const languageUrl = process.env.LANGUAGE_ENDPOINT!;

Host.getComment = async function (id) {
  const comment = await store.Comment.get(id);
  return {
    statusCode: 200,
    body: comment!,
  };
};

Host.listComments = async function () {
  return {
    statusCode: 200,
    body: await store.Comment.findAll(),
  };
};
