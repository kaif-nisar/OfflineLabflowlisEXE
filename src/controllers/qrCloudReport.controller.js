import os from "node:os";
import { QrCloudDevice } from "../models/qrCloudDevice.model.js";

const CLOUD_URL = String(process.env.LABFLOW_QR_CLOUD_URL || "https://labflowlis.com").replace(/\/$/, "");
const MAX_BASE64_LENGTH = Math.ceil((8 * 1024 * 1024 * 4) / 3) + 16;

const readJson = async (response) => response.json().catch(() => ({}));
const cloudError = (data, fallback) => data?.message || data?.error || fallback;

export const connectQrCloud = async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ success: false, message: "Cloud username and password are required." });

  try {
    const login = await fetch(`${CLOUD_URL}/api/v1/user/login-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, deviceFingerprint: `offline-${os.hostname()}` }),
    });
    const loginData = await readJson(login);
    if (!login.ok || !loginData?.accessToken) return res.status(401).json({ success: false, message: cloudError(loginData, "Cloud login failed.") });

    const issue = await fetch(`${CLOUD_URL}/api/v1/qr-reports/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginData.accessToken}` },
      body: JSON.stringify({ label: `LabFlow Offline — ${os.hostname()}` }),
    });
    const issueData = await readJson(issue);
    if (!issue.ok || !issueData?.deviceToken) return res.status(502).json({ success: false, message: cloudError(issueData, "Could not activate QR relay.") });

    await QrCloudDevice.findOneAndUpdate(
      { ownerId: req.user._id },
      { $set: { deviceToken: issueData.deviceToken, cloudUrl: CLOUD_URL, connectedAt: new Date(), lastUsedAt: null } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    return res.json({ success: true, message: "QR cloud connection is ready." });
  } catch (error) {
    console.error("QR cloud connection failed:", error.message);
    return res.status(502).json({ success: false, message: "Cloud service could not be reached. Check the internet connection." });
  }
};

export const createQrCloudLink = async (req, res) => {
  const pdfBase64 = String(req.body?.pdfBase64 || "").replace(/^data:application\/pdf;base64,/i, "");
  if (!pdfBase64 || pdfBase64.length > MAX_BASE64_LENGTH) return res.status(400).json({ success: false, message: "A valid PDF up to 8 MB is required." });
  const device = await QrCloudDevice.findOne({ ownerId: req.user._id }).select("+deviceToken");
  if (!device?.deviceToken) return res.status(409).json({ success: false, code: "QR_CLOUD_NOT_CONNECTED", message: "Connect LabFlow cloud once before creating QR links." });

  try {
    const upload = await fetch(`${device.cloudUrl}/api/v1/qr-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${device.deviceToken}` },
      body: JSON.stringify({ pdfBase64, fileName: req.body?.fileName, sourceReportId: req.body?.sourceReportId, bookingId: req.body?.bookingId }),
    });
    const uploadData = await readJson(upload);
    if (!upload.ok) {
      const status = upload.status === 401 ? 409 : 502;
      return res.status(status).json({ success: false, code: upload.status === 401 ? "QR_CLOUD_RECONNECT_REQUIRED" : undefined, message: cloudError(uploadData, "Could not create QR link.") });
    }
    await QrCloudDevice.updateOne({ _id: device._id }, { $set: { lastUsedAt: new Date() } });
    return res.status(201).json(uploadData);
  } catch (error) {
    console.error("QR report upload failed:", error.message);
    return res.status(502).json({ success: false, message: "Cloud service could not be reached. Check the internet connection." });
  }
};
