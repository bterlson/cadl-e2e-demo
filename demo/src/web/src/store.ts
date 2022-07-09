import { Writable, writable } from 'svelte/store';
import { CommentsClient, Comment } from './use/Comments';

const client = new CommentsClient(import.meta.env.VITE_API_ENDPOINT);

export function createCommentStore() {
  const store: Writable<Comment[]> = writable([]);
  const allComments = client.listComments();
  allComments.then(c => {
    store.set(c);
  });
  return store;
}

export const comments = createCommentStore();