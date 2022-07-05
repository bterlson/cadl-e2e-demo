#!/bin/env node

import { main } from "./dist/use.js";

main(process.argv.slice(2)).catch((e) => {
  console.error("[INTERNAL ERROR]", e);
  process.exit(1);
});
