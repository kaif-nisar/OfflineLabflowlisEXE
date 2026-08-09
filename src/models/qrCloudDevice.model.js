import mongoose from "mongoose";

const qrCloudDeviceSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    deviceToken: { type: String, required: true, select: false },
    cloudUrl: { type: String, required: true },
    connectedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const QrCloudDevice = mongoose.model("QrCloudDevice", qrCloudDeviceSchema);
