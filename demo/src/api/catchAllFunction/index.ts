import { AzureFunction, Context } from "@azure/functions";
import { DataStore } from "../store/data-store.js";
import appInsights from "applicationinsights";

const store = new DataStore(process.env.COSMOS_CONNECTION_STRING!)
await store.init();
const func: AzureFunction =  async function (context: Context, req, res) {
  context.log('JavaScript HTTP trigger function processed a request.');
  let comment = await store.Comment.add({contents: "hi!", sentiment: "testing" });
  // You can call and await an async method here
  return {
      body: comment
  };
}

export default func;