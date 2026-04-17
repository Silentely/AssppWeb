import type { Account, Software } from "../types";
import { appleRequest } from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { purchaseAPIHost } from "./config";
import i18n from "../i18n";

export class PurchaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

const LOG_PREFIX = "[Purchase]";

type UnknownDict = Record<string, unknown>;

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function trimForLog(value: unknown, maxLength: number = 160): string {
  const text = toOptionalString(value) ?? "";
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function asDict(value: unknown): UnknownDict | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownDict;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = toOptionalString(value);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

export async function purchaseApp(
  account: Account,
  app: Software,
): Promise<{ updatedCookies: typeof account.cookies }> {
  if ((app.price ?? 0) > 0) {
    throw new PurchaseError(i18n.t("errors.purchase.paidNotSupported"));
  }

  try {
    return await purchaseWithParams(account, app, "STDQ");
  } catch (e) {
    // Rely on error code instead of translated message string to prevent matching issues
    if (
      e instanceof PurchaseError &&
      (e.code === "2059" || e.code === "buyProductFailure")
    ) {
      return await purchaseWithParams(account, app, "GAME");
    }
    throw e;
  }
}

async function purchaseWithParams(
  account: Account,
  app: Software,
  pricingParameters: string,
): Promise<{ updatedCookies: typeof account.cookies }> {
  const deviceId = account.deviceIdentifier;
  const host = purchaseAPIHost(account.pod);
  const path = "/WebObjects/MZFinance.woa/wa/buyProduct";

  const payload: Record<string, any> = {
    appExtVrsId: "0",
    hasAskedToFulfillPreorder: "true",
    buyWithoutAuthorization: "true",
    hasDoneAgeCheck: "true",
    guid: deviceId,
    needDiv: "0",
    origPage: `Software-${app.id}`,
    origPageLocation: "Buy",
    price: "0",
    pricingParameters,
    productType: "C",
    salableAdamId: app.id,
  };

  const plistBody = buildPlist(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-apple-plist",
    "iCloud-DSID": account.directoryServicesIdentifier,
    "X-Dsid": account.directoryServicesIdentifier,
    "X-Apple-Store-Front": `${account.store}-1`,
    "X-Token": account.passwordToken,
  };

  console.info(`${LOG_PREFIX} request start`, {
    host,
    path,
    appId: app.id,
    bundleID: app.bundleID,
    store: account.store,
    pod: account.pod ?? "",
    pricingParameters,
  });

  const response = await appleRequest({
    method: "POST",
    host,
    path,
    headers,
    body: plistBody,
    cookies: account.cookies,
  });

  console.info(`${LOG_PREFIX} response received`, {
    status: response.status,
    statusText: response.statusText,
    bodyLength: response.body.length,
    hasSetCookie: response.rawHeaders.some(
      ([key]) => key.toLowerCase() === "set-cookie",
    ),
  });

  const updatedCookies = extractAndMergeCookies(
    response.rawHeaders,
    account.cookies,
  );

  const dict = parsePlist(response.body) as UnknownDict;
  const dialog = asDict(dict.dialog);
  const action = asDict(dict.action);
  const failureType = firstString(dict.failureType, dialog?.failureType);
  const customerMessage = firstString(
    dict.customerMessage,
    dict.failureMessage,
    dict.userPresentableErrorMessage,
    dialog?.explanation,
    dialog?.message,
    action?.message,
  );
  const jingleDocType = firstString(dict.jingleDocType);
  const status = toOptionalNumber(dict.status);
  const rootKeys = Object.keys(dict).slice(0, 20);
  const dialogKeys = dialog ? Object.keys(dialog).slice(0, 20) : [];

  console.info(`${LOG_PREFIX} parsed response`, {
    appId: app.id,
    bundleID: app.bundleID,
    failureType: failureType ?? "",
    customerMessage: trimForLog(customerMessage),
    jingleDocType: jingleDocType ?? "",
    status: status ?? "",
    rootKeys,
    dialogKeys,
  });

  if (failureType) {
    console.warn(`${LOG_PREFIX} response has failureType`, {
      appId: app.id,
      bundleID: app.bundleID,
      failureType,
      customerMessage: trimForLog(customerMessage),
      pricingParameters,
    });
    switch (failureType) {
      case "2059":
        throw new PurchaseError(i18n.t("errors.purchase.unavailable"), "2059");
      case "2034":
      case "2042":
        throw new PurchaseError(
          i18n.t("errors.purchase.passwordExpired"),
          failureType,
        );
      default: {
        if (customerMessage === "Your password has changed.") {
          throw new PurchaseError(
            i18n.t("errors.purchase.passwordExpired"),
            failureType,
          );
        }
        if (customerMessage === "Subscription Required") {
          throw new PurchaseError(
            i18n.t("errors.purchase.subscriptionRequired"),
            failureType,
          );
        }
        // Check for terms page action
        if (action) {
          const actionUrl = firstString(action.url, action.URL);
          if (actionUrl && actionUrl.endsWith("termsPage")) {
            throw new PurchaseError(
              i18n.t("errors.purchase.termsRequired", { url: actionUrl }),
              failureType,
            );
          }
        }

        // Handle unknown error specific fallback mappings
        let msg = customerMessage;
        if (
          msg === "An unknown error has occurred" ||
          msg === "An unknown error has occurred."
        ) {
          msg = i18n.t("errors.purchase.unknownError");
        }

        throw new PurchaseError(
          msg ?? i18n.t("errors.purchase.failed", { failureType }),
          failureType,
        );
      }
    }
  }

  if (status === 0) {
    if (jingleDocType && jingleDocType !== "purchaseSuccess") {
      console.warn(
        `${LOG_PREFIX} success status with unexpected jingleDocType`,
        {
          appId: app.id,
          bundleID: app.bundleID,
          jingleDocType,
          pricingParameters,
        },
      );
    }
    return { updatedCookies };
  }

  const statusCode = toOptionalString(status);
  const genericCode = statusCode ?? jingleDocType ?? "unknown";

  console.error(`${LOG_PREFIX} purchase failed without failureType`, {
    appId: app.id,
    bundleID: app.bundleID,
    status: status ?? "",
    jingleDocType: jingleDocType ?? "",
    customerMessage: trimForLog(customerMessage),
    pricingParameters,
  });

  if (customerMessage) {
    throw new PurchaseError(customerMessage, genericCode);
  }

  if (jingleDocType === "buyProductFailure") {
    throw new PurchaseError(
      i18n.t("errors.purchase.unavailable"),
      "buyProductFailure",
    );
  }

  throw new PurchaseError(
    i18n.t("errors.purchase.failed", { failureType: genericCode }),
    genericCode,
  );
}
