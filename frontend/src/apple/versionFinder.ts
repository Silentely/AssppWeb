import type { Account, Software } from "../types";
import { appleRequest } from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { storeAPIHost } from "./config";
import i18n from "../i18n";

export class VersionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "VersionError";
  }
}

/**
 * 会话令牌过期：调用方可据此触发重新认证后重试。
 */
export function isVersionAuthExpired(error: unknown): boolean {
  return (
    error instanceof VersionError &&
    (error.code === "2034" || error.code === "2042" || error.code === "1008")
  );
}

export async function listVersions(
  account: Account,
  app: Software,
): Promise<{ versions: string[]; updatedCookies: typeof account.cookies }> {
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
        throw new VersionError(i18n.t("errors.download.redirectLocation"));
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
      if (dict.failureType) {
        const failureType = String(dict.failureType);
        switch (failureType) {
          case "2034":
          case "2042":
          case "1008":
            throw new VersionError(
              i18n.t("errors.download.passwordExpired"),
              failureType,
            );
          case "9610":
            throw new VersionError(
              i18n.t("errors.download.licenseRequired"),
              "9610",
            );
          default: {
            const msg = dict.customerMessage as string | undefined;
            throw new VersionError(
              msg ?? i18n.t("errors.download.noItems"),
              failureType,
            );
          }
        }
      }
      throw new VersionError(i18n.t("errors.download.noItems"));
    }

    const item = songList[0];
    const metadata = item.metadata as Record<string, any> | undefined;
    if (!metadata) {
      throw new VersionError(
        i18n.t("errors.download.missingVersionIdentifiers"),
      );
    }

    const identifiers = metadata.softwareVersionExternalIdentifiers;
    if (!Array.isArray(identifiers)) {
      throw new VersionError(
        i18n.t("errors.download.missingVersionIdentifiers"),
      );
    }

    const versions = identifiers.map((id) => String(id)).reverse();
    if (versions.length === 0) {
      throw new VersionError(i18n.t("errors.download.noVersionsFound"));
    }

    return { versions, updatedCookies: cookies };
  }

  throw new VersionError(i18n.t("errors.download.tooManyRedirects"));
}
