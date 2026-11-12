import { defineEventHandler } from "h3";
import { requireSiteConfigToken } from "../../utils/configAuth.ts";
import { buildQQGroupsView } from "../../utils/qqGroups.ts";

export default defineEventHandler((event) => {
  requireSiteConfigToken(event);
  return buildQQGroupsView();
});
