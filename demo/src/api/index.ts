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

Host.createComment = async function (comment) {
  const result = await analyzeSentiment(languageUrl, credential, {
    documents: [
      {
        id: "1",
        text: comment.contents,
        language: "en",
      },
    ],
  });

  const sentiment =
    result.documents.find(({ id }) => id === "1")?.sentiment ?? "unknown";
  const commentWithSentiment = { ... comment, sentiment };
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

Host.createComment = async function (comment) {
  const result = await analyzeSentiment(languageUrl, credential, {
    documents: [
      {
        id: "1",
        text: comment.contents,
        language: "en",
      },
    ],
  });

  const sentiment =
    result.documents.find(({ id }) => id === "1")?.sentiment ?? "unknown";
  const commentWithSentiment = { ... comment, sentiment };
  const savedComment = await store.Comment.add(commentWithSentiment);
  return {
    statusCode: 200,
    body: savedComment
  }
}