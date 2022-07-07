import { Host } from "./Host.js";
import { DataStore } from "./store/data-store.js";
import { getSecret } from "./use/Microsoft/KeyVault/Secrets/getSecret.js";
import { DefaultAzureCredential } from "@azure/identity";

const cred = new DefaultAzureCredential();
const cosmosSecret = await getSecret(
  new URL(process.env.AZURE_KEY_VAULT_ENDPOINT!),
  cred,
  "cosmosConnectionString",
  "7.3"
);
const store = new DataStore(cosmosSecret.value!);
await store.init();

Host.createComment = async function (comment) {
  const commentWithSentiment = { ... comment, sentiment: "hi!" };
  const createdComment = await store.Comment.add(commentWithSentiment);
  return {
    statusCode: 200,
    body: createdComment
  }
}

Host.getComment = async function (id) {
  const comment = await store.Comment.get(id);
  return {
    statusCode: 200,
    body: comment!,
  };
};

Host.listComments = async function () {
  const comments = await store.Comment.findAll();

  return {
    statusCode: 200,
    body: comments
  }
}