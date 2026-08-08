import type { Account, Software, VersionMetadata } from "../types";
import { appleRequest } from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { storeAPIHost } from "./config";
import i18n from "../i18n";

export async function getVersionMetadata(
  account: Account,
  app: Software,
  versionId: string,
): Promise<{
  metadata: VersionMetadata;
  updatedCookies: typeof account.cookies;
}> {
  const deviceId = account.deviceIdentifier;

  let requestHost = storeAPIHost(account.pod);
  let requestPath = `/WebObjects/MZFinance.woa/wa/volumeStoreDownloadProduct?guid=${deviceId}`;
  let cookies = [...account.cookies];
  let redirectAttempt = 0;

  while (redirectAttempt <= 3) {
    const payload: Record<string, string | number> = {
      creditDisplay: "",
      guid: deviceId,
      salableAdamId: app.id,
      externalVersionId: versionId,
    };

    const plistBody = buildPlist(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-apple-plist",
      "iCloud-DSID": account.directoryServicesIdentifier,
      "X-Dsid": account.directoryServicesIdentifier,
    };

    const response = await appleRequest({
      method: "POST",
      host: requestHost,
      path: requestPath,
      headers,
      body: plistBody,
      cookies,
    });

    cookies = extractAndMergeCookies(response.rawHeaders, cookies, requestHost);

    if (response.status === 302) {
      const location = response.headers["location"];
      if (!location) {
        throw new Error(i18n.t("errors.download.redirectLocation"));
      }
      const url = new URL(location);
      requestHost = url.hostname;
      requestPath = url.pathname + url.search;
      redirectAttempt++;
      continue;
    }

    const dict = parsePlist(response.body) as Record<string, any>;

    const songList = dict.songList as Record<string, any>[] | undefined;
    if (!songList || songList.length === 0) {
      throw new Error(i18n.t("errors.download.noItems"));
    }

    const item = songList[0];
    const itemMetadata = item.metadata as Record<string, any> | undefined;
    if (!itemMetadata) {
      throw new Error(i18n.t("errors.download.missingMetadata"));
    }

    const bundleShortVersionString =
      itemMetadata.bundleShortVersionString as string | undefined;
    if (!bundleShortVersionString) {
      throw new Error(i18n.t("errors.download.missingVersion"));
    }

    const rawReleaseDate = itemMetadata.releaseDate;
    if (!rawReleaseDate) {
      throw new Error(i18n.t("errors.download.missingReleaseDate"));
    }
    const releaseDate =
      rawReleaseDate instanceof Date
        ? rawReleaseDate.toISOString()
        : String(rawReleaseDate);

    return {
      metadata: {
        displayVersion: bundleShortVersionString,
        releaseDate,
      },
      updatedCookies: cookies,
    };
  }

  throw new Error(i18n.t("errors.download.tooManyRedirects"));
}
