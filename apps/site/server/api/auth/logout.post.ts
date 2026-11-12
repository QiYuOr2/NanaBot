import { defineEventHandler, setHeader } from "h3";
import { clearSiteSession } from "../../utils/configAuth.ts";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  clearSiteSession(event);
  return { authenticated: false };
});
