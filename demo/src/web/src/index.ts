import { CommentsClient } from "./use/Comments.js";

import config from "./env.js";

const client = new CommentsClient(config.API_ENDPOINT);

async function refreshComments() {
  const comments = await client.listComments();

  const container = document.getElementById("comments");

  container?.replaceChildren(
    ...comments.map(({ id, contents, sentiment }) => {
      const elt = document.createElement("li");

      elt.replaceChildren(id, " ", contents, " ", sentiment);

      return elt;
    })
  );
}

async function submitComment() {
  const commentArea = document.getElementById(
    "commentText"
  ) as HTMLTextAreaElement;
  const button = document.getElementById("commentSubmit") as HTMLButtonElement;

  commentArea.disabled = true;
  button.disabled = true;

  const contents = commentArea.value;

  await client.createComment({ contents });

  commentArea.value = "";

  await refreshComments();

  commentArea.disabled = false;
  button.disabled = false;
}

console.dir(window);

(window as any).refreshComments = refreshComments;
(window as any).submitComment = submitComment;
(window as any).CommentsClient = CommentsClient;
