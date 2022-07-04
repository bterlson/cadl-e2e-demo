import { rm, cp } from "fs/promises";
await rm("infra", { recursive: true, force: true});
await rm("azure.yaml", { force: true });
await cp("cadl-output/infra", "./infra", {recursive: true});
await cp("cadl-output/azure.yaml", "./azure.yaml");
await cp("cadl-output/store", "./src/api/store", {recursive: true, force: true});