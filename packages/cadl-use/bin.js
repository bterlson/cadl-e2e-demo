#!/bin/env node

import { use } from "./dist/use.js";

use(process.argv.slice(2)).catch((e) => {
  console.error("[INTERNAL ERROR]", e);
  process.exit(1);
});
