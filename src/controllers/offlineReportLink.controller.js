import {
  offlineReportIdFor,
  queueOfflineReport,
  removeOfflineReportQr,
} from "../utils/offlineReportSync.js";
import { readAssetAsBuffer, getMimeType } from "../utils/pdfOfflineAssets.js";
import { resolveUsableBackgroundImageUrl } from "./pdfgenerator.controller.js";

const value = (input, fallback = "") => input ?? fallback;

// This bridge is intentionally small: the desktop page sends the same rendered
// report payload it already uses for its PDF. There is no cloud login, device
// activation, or client-held access token in this offline flow.
export const createOfflineReportLink = async (req, res) => {
  const body = req.body || {};
  const reportId = String(body.reportId || body.value1 || "");
  const bookingId = String(body.bookingId || "");
  if (!reportId || !bookingId || !body.htmlContent) {
    return res.status(400).json({ success: false, message: "Report details are incomplete; QR link cannot be prepared." });
  }

  const tenantId = req.user?.tenantId?._id || req.user?.tenantId || "";
  const offlineReportId = offlineReportIdFor({ reportId, bookingId, tenantId });
  const pdfFormat = req.user?.role === "admin"
    ? req.user?.pdfFormat
    : req.user?.createdBy?.pdfFormat;
  const payload = {
    offlineReportId,
    bookingId,
    reportId,
    pdfFormat: body.pdfFormat || pdfFormat || "reportFormat1",
    htmlContent: removeOfflineReportQr(body.htmlContent),
    cssContent: value(body.cssContent),
    header: value(body.header),
    footer: value(body.footer),
    // Background image: if already a public https URL pass as-is.
    // If a local /uploads/ path or empty, resolve usable background template from DB
    // and embed as base64 data URL so cloud renderer COMPULSORILY includes background.
    backgroundImageUrl: await (async () => {
      let rawUrl = String(body.backgroundImageUrl || "");
      if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
      if (!rawUrl && tenantId) {
        try {
          rawUrl = await resolveUsableBackgroundImageUrl(tenantId, "");
        } catch (err) {
          console.warn("[offline-report-link] Failed to resolve template image:", err);
        }
      }
      if (!rawUrl) return "";
      try {
        const asset = await readAssetAsBuffer(rawUrl);
        if (!asset?.buffer) return "";
        const mime = asset.mimeType || getMimeType(rawUrl) || "image/jpeg";
        return `data:${mime};base64,${asset.buffer.toString("base64")}`;
      } catch {
        return "";
      }
    })(),
    showInvest: value(body.showInvest, true),
    BoldRow: value(body.BoldRow, true),
    HLinred: value(body.HLinred, false),
    HighLow: value(body.HighLow, true),
    RowSpacing: value(body.RowSpacing, 7),
    selectedFontSize: value(body.selectedFontSize, 12),
    selectedFontFamily: value(body.selectedFontFamily, "Arial"),
    hideCategories: value(body.hideCategories, false),
    hideTableHeadings: value(body.hideTableHeadings, false),
    headermargin: value(body.headermargin, "2.8"), footermargin: value(body.footermargin, "1"),
    marginRight: value(body.marginRight, "0"), marginLeft: value(body.marginLeft, "0"),
    LeftsignPd: value(body.LeftsignPd, "0"), Rightsignpd: value(body.Rightsignpd, "0"),
    investigationmargin: value(body.investigationmargin, 40),
    showlab: value(body.showlab, false), showdoctorfirst: value(body.showdoctorfirst, true), showdoctorsecond: value(body.showdoctorsecond, true),
    fileInputLab: value(body.fileInputLab), fileInputDoctorleft: value(body.fileInputDoctorleft), fileInputDoctorright: value(body.fileInputDoctorright),
    fileInputLabtext: value(body.fileInputLabtext), fileInputDoctorlefttext: value(body.fileInputDoctorlefttext), fileInputDoctorrighttext: value(body.fileInputDoctorrighttext),
  };

  try {
    const sync = await queueOfflineReport({ offlineReportId, reportId, bookingId, payload });
    if (!sync?.downloadUrl) {
      return res.status(503).json({ success: false, queued: true, message: sync?.lastError || "Report is queued for cloud sync. Connect to the internet and try again." });
    }
    return res.json({ success: true, downloadUrl: sync.downloadUrl, expiresAt: sync.expiresAt });
  } catch (error) {
    console.error("[offline-report-link] failed:", error.message);
    return res.status(500).json({ success: false, message: "Offline report link could not be prepared." });
  }
};
