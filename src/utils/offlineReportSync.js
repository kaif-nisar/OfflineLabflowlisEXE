import qr from "qrcode";
import { OfflineReportSync } from "../models/offlineReportSync.model.js";

const CLOUD_ENDPOINT = `${String(process.env.LABFLOW_OFFLINE_REPORTS_URL || "https://labflowlis.com/api/v1/offline-reports").replace(/\/$/, "")}`;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

const text = (value) => String(value ?? "");
const errorMessage = (data, fallback) => text(data?.message || data?.error || fallback);
const retryDelay = (attempts) => Math.min(MAX_RETRY_DELAY_MS, 30_000 * (2 ** Math.min(attempts, 11)));

export const offlineReportIdFor = ({ reportId, bookingId, tenantId }) => {
  // reportId is the immutable local Mongo ObjectId; the fallback remains stable
  // within a tenant for legacy reports that predate report ObjectIds.
  return reportId ? `offline-report:${text(reportId)}` : `offline-booking:${text(tenantId)}:${text(bookingId)}`;
};

export const removeOfflineReportQr = (html) => text(html)
  .replace(/(<img\b[^>]*\bid\s*=\s*["']qrimg["'][^>]*?)\s+src\s*=\s*(["'])[^"']*\2/gi, "$1")
  .replace(/(<img\b[^>]*\bid\s*=\s*["']qrimg["'][^>]*?)\s+src\s*=\s*[^\s>]+/gi, "$1");

export const injectOfflineReportQr = async (html, downloadUrl) => {
  const qrDataUrl = await qr.toDataURL(downloadUrl, { margin: 2 });
  const cleanHtml = removeOfflineReportQr(html);
  const qrTag = `<img id="qrimg" src="${qrDataUrl}" alt="Scan to download report" />`;

  if (/<img\b[^>]*\bid\s*=\s*["']qrimg["'][^>]*>/i.test(cleanHtml)) {
    return cleanHtml.replace(/<img\b(?=[^>]*\bid\s*=\s*["']qrimg["'])[^>]*>/i, qrTag);
  }

  // If no #qrimg placeholder exists in this snippet, do not append a QR tag to the body.
  return cleanHtml;
};

const markFailure = async (sync, error) => {
  const attempts = Number(sync.attempts || 0) + 1;
  const lastError = error instanceof Error ? error.message : text(error);
  return OfflineReportSync.findByIdAndUpdate(sync._id, {
    $set: { status: "queued", attempts, lastError, lastAttemptAt: new Date(), nextRetryAt: new Date(Date.now() + retryDelay(attempts)) },
  }, { returnDocument: 'after' });
};

export const uploadOfflineReportSync = async (sync) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  await OfflineReportSync.updateOne({ _id: sync._id }, { $set: { status: "syncing", lastAttemptAt: new Date() } });

  try {
    const response = await fetch(CLOUD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sync.payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || !data?.downloadUrl) {
      throw new Error(errorMessage(data, `Offline report upload failed (${response.status}).`));
    }

    return OfflineReportSync.findByIdAndUpdate(sync._id, {
      $set: {
        status: "synced", lastError: "", lastSyncedAt: new Date(), nextRetryAt: null,
        cloudResponse: data, downloadUrl: data.downloadUrl, downloadToken: data.downloadToken || "",
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    }, { returnDocument: 'after' });
  } catch (error) {
    console.warn("[offline-report-sync] upload deferred:", error?.message || error);
    return markFailure(sync, error?.name === "AbortError" ? new Error("Cloud sync timed out; queued for retry.") : error);
  } finally {
    clearTimeout(timeout);
  }
};

export const queueOfflineReport = async ({ offlineReportId, reportId, bookingId, payload }) => {
  const sync = await OfflineReportSync.findOneAndUpdate(
    { offlineReportId },
    { $set: { reportId: text(reportId), bookingId: text(bookingId), payload, status: "queued", nextRetryAt: new Date(), lastError: "" } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  return uploadOfflineReportSync(sync);
};

export const syncPendingOfflineReports = async ({ limit = 20 } = {}) => {
  const pending = await OfflineReportSync.find({ status: { $ne: "syncing" }, nextRetryAt: { $lte: new Date() } }).sort({ nextRetryAt: 1 }).limit(limit);
  for (const sync of pending) await uploadOfflineReportSync(sync);
  return pending.length;
};

export const getOfflineReportSyncStatus = async (reportId) => OfflineReportSync.findOne({ reportId: text(reportId) }).lean();
