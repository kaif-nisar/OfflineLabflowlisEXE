import mongoose from "mongoose";

// This is intentionally separate from Customization.  Offline-report sync state
// is transport metadata, not a cloud report customization record.
const offlineReportSyncSchema = new mongoose.Schema(
  {
    offlineReportId: { type: String, required: true, unique: true, index: true },
    reportId: { type: String, default: "", index: true },
    bookingId: { type: String, default: "" },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["queued", "syncing", "synced", "failed"], default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    lastAttemptAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    cloudResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    downloadUrl: { type: String, default: "" },
    downloadToken: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const OfflineReportSync = mongoose.model("OfflineReportSync", offlineReportSyncSchema);
