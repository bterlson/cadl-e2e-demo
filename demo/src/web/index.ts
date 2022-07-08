import { CommentsClient } from "./use/Comments.js";

const client = new CommentsClient(
  "https://app-api-rnknowjwlgiqa.azurewebsites.net/api"
);

async function refreshComments() {
  const comments = await client.listComments();

  for (const comment of comments) {
    console.log(comment.contents);
  }
}

console.dir(window);

(window as any).refreshComments = refreshComments;
