import { Host } from "./Host.js";
import { DataStore } from "./store/data-store.js";

import { DefaultAzureCredential } from "@azure/identity";

const keyVaultUrl = process.env.AZURE_KEY_VAULT_ENDPOINT!;
const credential = new DefaultAzureCredential();

const cosmosKey = process.env.cosmosConnectionStringValue;

const store = new DataStore(cosmosKey!);
await store.init();

Host.getComment = async function (id) {
  const comment = await store.Comment.get(id);
  return {
    statusCode: 200,
    body: comment!,
  };
};

Host.createComment = async function (comment) {
  const commentWithSentiment = { ... comment, sentiment: "unknown" };
  const savedComment = await store.Comment.add(commentWithSentiment);
  return {
    statusCode: 200,
    body: savedComment
  }
}

Host.listComments = async function() {
  const comments = await store.Comment.findAll();
  return {
    statusCode: 200,
    body: comments
  }
}