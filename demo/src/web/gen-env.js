#!/bin/env node

import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

const azdPath = path.resolve(process.cwd(), "..", "..", ".azure");

const { defaultEnvironment } = JSON.parse(
  fs.readFileSync(path.join(azdPath, "config.json")).toString("utf-8")
);

const env = dotenv.parse(
  fs.readFileSync(path.join(azdPath, defaultEnvironment, ".env"))
);

if (env.API_ENDPOINT === undefined)
  throw new Error(
    "No API_ENDPOINT defined in the default azure-dev environment."
  );

const data = `// Generated - Do not edit!

export default {
    API_ENDPOINT: "https://${env.API_ENDPOINT}/api"
}
`;

const outputFileName = path.join(process.cwd(), "build/script/env.js");

await fs.promises.mkdir(path.dirname(outputFileName), { recursive: true });

await fs.promises.writeFile(outputFileName, data);
