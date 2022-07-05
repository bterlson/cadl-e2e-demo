import { DefaultAzureCredential } from "@azure/identity";

import { analyzeSentiment } from "./analyzeSentiment.js";

import * as dotenv from "dotenv";
dotenv.config();

const languageUrl = new URL(process.env.LANGUAGE_URL ?? "<language endpoint>");

const credential = new DefaultAzureCredential();

const sentimentResult = await analyzeSentiment(
  languageUrl,
  credential,
  {
    documents: [
      {
        id: "1",
        text: "Wow! I am so impressed with Cadl's capabilities. It really makes me smile.",
        language: "en",
      },
    ],
  },
  { opinionMining: true, stringIndexType: "Utf16CodeUnit" }
);

const sentences = sentimentResult.documents.find(
  (d) => d.id === "1"
)?.sentences;

for (const sentence of sentences ?? []) {
  console.log(`(${sentence.sentiment}) "${sentence.text}"`);

  for (const assessment of sentence.assessements ?? []) {
    console.log(`- Assessed: (${assessment.sentiment}) ${assessment.text}`);
  }
}
