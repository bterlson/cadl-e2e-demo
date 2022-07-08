import { rm, cp } from "fs/promises";
await rm("infra", { recursive: true, force: true });
await rm("azure.yaml", { force: true });
await cp("cadl-output/infra", "./infra", { recursive: true });
await cp("cadl-output/azure.yaml", "./azure.yaml");
await cp("cadl-output/store", "./src/api/store", {
  recursive: true,
  force: true,
});
await cp("cadl-output/use/demoapp", "./src/api/use", {
  recursive: true,
  force: true,
});
await cp("cadl-output/use/static", "./src/web/src/use", {
  recursive: true,
  force: true,
});
await cp("cadl-output/api", "./src/api", { recursive: true, force: true });
await cp("cadl-output/api", "./src/api", { recursive: true, force: true });
await cp("cadl-output/openapi.json", "./openapi.json", { force: true });
