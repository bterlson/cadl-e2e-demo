<script lang="ts">
  import { CommentsClient } from "../use/Comments";
  import { comments } from "../store";
</script>

<ul>
  {#each $comments as comment}
    <li>
      <b>Comment: </b>{comment.contents}<br />
      <b>Sentiment:</b>
      {comment.sentiment}
    </li>
  {/each}
</ul>

<style>
  ul {
    max-width: 500px;
    margin: auto;
    list-style-type: none;
    text-align: left;
  }

  li {
    margin: 10px 0px;
  }
</style>
