<script lang="ts">
  import { CommentsClient, CommentRequest } from "../use/Comments";
  import { comments } from "../store";
  const client = new CommentsClient(import.meta.env.VITE_API_ENDPOINT);
  let newComment: CommentRequest = { contents: "" };

  async function saveComment() {
    const savedComment = await client.createComment(newComment);
    comments.update((comments) => {
      return [savedComment, ...comments];
    });
    newComment.contents = "";
    return false;
  }
</script>

<form on:submit|preventDefault={saveComment}>
  <label for="newComment">Enter a comment:</label><br />
  <textarea id="newComment" bind:value={newComment.contents} />
  <br />
  <button type="submit">Save</button>
</form>

<style>
  textarea {
    width: 500px;
    font-size: 20px;
  }
  button {
    font-family: inherit;
    font-size: inherit;
    padding: 1em 2em;
    color: #ff3e00;
    background-color: rgba(255, 62, 0, 0.1);
    border-radius: 2em;
    border: 2px solid rgba(255, 62, 0, 0);
    outline: none;
    width: 200px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  button:focus {
    border: 2px solid #ff3e00;
  }

  button:active {
    background-color: rgba(255, 62, 0, 0.2);
  }
</style>
