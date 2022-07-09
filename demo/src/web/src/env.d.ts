import { config } from "process";

declare module "./env.js" {
  declare const config: { API_ENDPOINT: string };
  export default config;
}
