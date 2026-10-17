import { queryOptions } from "@tanstack/react-query";
import {
  checkWordpressConnection,
  getWordpressConnection,
  listSiteFixChanges,
} from "@/serverFunctions/wordpress";

export const wordpressConnectionOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["wordpressConnection", projectId],
    queryFn: () => getWordpressConnection({ data: { projectId } }),
  });

/** Live check of the site and its OpenSEO Connector plugin. */
export const wordpressCheckOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["wordpressCheck", projectId],
    queryFn: () => checkWordpressConnection({ data: { projectId } }),
    staleTime: 60_000,
  });

export const siteFixChangesOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["siteFixChanges", projectId],
    queryFn: () => listSiteFixChanges({ data: { projectId } }),
  });
