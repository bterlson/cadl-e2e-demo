/*
import "dotenv/config";
import { DataStore } from "../cadl-output/store/data-store.js";
const store = new DataStore(
  process.env.COSMOS_ENDPOINT!,
  process.env.COSMOS_API_KEY!
);
await store.init();

await store.Person.add({ age: 10, favoriteSport: "baseball", name: "hi" });

for (const res of await store.Person.findAll()) {
  console.log(res)
}
*/
