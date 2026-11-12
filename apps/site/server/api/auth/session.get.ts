import { defineEventHandler, setHeader } from "h3";
import { hasSiteSession, readSiteConfigToken } from "../../utils/configAuth.ts";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "no-store");
  return { configured: Boolean(readSiteConfigToken()), authenticated: hasSiteSession(event) };
});
