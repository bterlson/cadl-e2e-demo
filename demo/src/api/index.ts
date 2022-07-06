import {Host} from "./Host.js";
import { DataStore } from "./store/data-store.js";
import { getSecret } from "./use/Microsoft/KeyVault/Secrets/getSecret.js";
const store = new DataStore(process.env.COSMOS_CONNECTION_STRING!);
await store.init();

Host.createComment = async function(comment) {
  const commentWithSentiment = { ... comment, sentiment: "hi!" }
  const createdComment = await store.Comment.add(commentWithSentiment);
  return {
    statusCode: 200,
    body: createdComment
  }
}

Host.getComment = async function(id) {
  const comment = await store.Comment.get(id);
  return {
    statusCode: 200,
    body: comment!
  }
}