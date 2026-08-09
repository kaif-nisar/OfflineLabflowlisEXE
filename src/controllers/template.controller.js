import fsPromises from "fs/promises";
import path from "path";
import { User } from "../models/user.model.js";
import { Template } from "../models/template.model.js";
import {
    storeLocalFile,
    deleteLocalFile,
    doesLocalFileExist,
    normalizeStoredUploadUrl,
    resolveLocalStoredFilePath,
} from "../utils/localStorage.js";

const getMimeTypeFromFileName = (fileName) => {
    const ext = path.extname(fileName || "").toLowerCase();
    switch (ext) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".svg":
            return "image/svg+xml";
        case ".gif":
            return "image/gif";
        default:
            return "image/png";
    }
};

const convertFileToBase64 = async (filePath, mimeType) => {
    try {
        if (!filePath) return "";
        const buffer = await fsPromises.readFile(filePath);
        const mime = mimeType || getMimeTypeFromFileName(filePath);
        return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch (error) {
        console.error("Error converting file to base64:", error);
        return "";
    }
};

const normalizeTemplatePublicId = (value) => {
    const normalizedUrl = normalizeStoredUploadUrl(value);
    if (normalizedUrl) {
        return normalizedUrl.replace(/^\/uploads\//, "");
    }

    const rawValue = String(value || "").trim().replace(/\\/g, "/");
    if (!rawValue || /^https?:\/\//i.test(rawValue)) {
        return "";
    }

    return rawValue.replace(/^\/?uploads\//, "");
};

const normalizeTemplateRecord = async (templateDoc) => {
    const normalizedTemplateUrl = normalizeStoredUploadUrl(templateDoc.template);
    const normalizedPublicId =
        normalizeTemplatePublicId(templateDoc.public_id) ||
        normalizeTemplatePublicId(templateDoc.template);
    const fileExists = await doesLocalFileExist(normalizedPublicId || normalizedTemplateUrl);

    return {
        normalizedTemplateUrl,
        normalizedPublicId,
        fileExists,
    };
};

const uploadImage = async (req, res) => {
    try {
        let userId;
        if (req.user.role === "staff") {
            userId = req.user.parentUser;
        } else {
            userId = req.user._id;
        }

        if (!req.files) {
            return res.status(400).json({ message: "No file uploaded or file type is not supported" });
        }

        const uploadedTemplate = req.files?.template?.[0];
        if (!uploadedTemplate) {
            return res.status(400).json({ message: "Template file is required" });
        }

        // Convert uploaded template file to base64 Data URL string
        const base64Data = await convertFileToBase64(uploadedTemplate.path, uploadedTemplate.mimetype);

        const result = await storeLocalFile(uploadedTemplate.path, {
            category: "reports",
            fileName: uploadedTemplate.originalname,
        });

        if (!result) {
            return res.status(500).json({ message: "Failed to store template locally" });
        }

        const newTemplate = new Template({
            tenantId: req.user.tenantId._id,
            createdBy: userId,
            template: result.secure_url,
            public_id: result.public_id,
            backgroundImageInBase64: base64Data,
        });
        await newTemplate.save();

        if (req.user.role === "staff") {
            await User.findByIdAndUpdate(req.user._id, {
                $push: {
                    activities: {
                        activityType: "other",
                        details: {
                            staffId: req.user._id,
                            staffName: req.user.fullName,
                            action: `${req.user.fullName} uploaded a new template.`,
                            template: newTemplate._id,
                        },
                        reference: {
                            model: "Template",
                            id: newTemplate._id,
                        },
                        timestamp: new Date(),
                    },
                },
            });
        }

        return res.status(201).json({
            message: "File uploaded successfully",
            url: result.secure_url,
            public_id: result.public_id,
            templateId: newTemplate._id,
            backgroundImageInBase64: base64Data,
        });
    } catch (error) {
        console.error("Error uploading image:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

const getAllTemplates = async (req, res) => {
    try {
        const templates = await Template.find({
            tenantId: req.user.tenantId._id,
        }).sort({ _id: -1 });

        const validTemplates = [];
        const staleTemplateIds = [];

        for (const templateDoc of templates) {
            const {
                normalizedTemplateUrl,
                normalizedPublicId,
                fileExists,
            } = await normalizeTemplateRecord(templateDoc);

            if (!normalizedTemplateUrl || !fileExists) {
                staleTemplateIds.push(templateDoc._id);
                continue;
            }

            let needsSave = false;

            if (
                templateDoc.template !== normalizedTemplateUrl ||
                (normalizedPublicId && templateDoc.public_id !== normalizedPublicId)
            ) {
                templateDoc.template = normalizedTemplateUrl;
                templateDoc.public_id = normalizedPublicId;
                needsSave = true;
            }

            // Backfill base64 for legacy templates if missing
            if (!templateDoc.backgroundImageInBase64) {
                const resolvedFilePath = resolveLocalStoredFilePath(normalizedPublicId || normalizedTemplateUrl);
                if (resolvedFilePath) {
                    const base64Str = await convertFileToBase64(resolvedFilePath);
                    if (base64Str) {
                        templateDoc.backgroundImageInBase64 = base64Str;
                        needsSave = true;
                    }
                }
            }

            if (needsSave) {
                await templateDoc.save();
            }

            validTemplates.push(templateDoc);
        }

        if (staleTemplateIds.length > 0) {
            await Template.deleteMany({ _id: { $in: staleTemplateIds } });
        }

        if (validTemplates.length === 0) {
            return res.status(404).json({ message: "No templates found" });
        }

        return res.status(200).json({ urls: validTemplates });
    } catch (error) {
        console.error("Error fetching templates:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

const deleteImage = async (req, res) => {
    try {
        const { url, public_id, templateId } = req.body;

        if (!url && !public_id && !templateId) {
            return res.status(400).json({ message: "Image URL, template id, or file id is required" });
        }

        const tenantFilter = {
            tenantId: req.user.tenantId._id,
        };

        let deletedTemplate = null;

        if (templateId) {
            deletedTemplate = await Template.findOneAndDelete({
                ...tenantFilter,
                _id: templateId,
            });
        } else {
            const normalizedUrl = normalizeStoredUploadUrl(url);
            const normalizedPublicId =
                normalizeTemplatePublicId(public_id) ||
                normalizeTemplatePublicId(url);
            const urlCandidates = [url, normalizedUrl].filter(Boolean);
            const publicIdCandidates = [public_id, normalizedPublicId].filter(Boolean);

            deletedTemplate = await Template.findOneAndDelete({
                ...tenantFilter,
                $or: [
                    ...(urlCandidates.length > 0 ? [{ template: { $in: urlCandidates } }] : []),
                    ...(publicIdCandidates.length > 0 ? [{ public_id: { $in: publicIdCandidates } }] : []),
                ],
            });
        }

        if (!deletedTemplate) {
            return res.status(404).json({ message: "Image not found in database" });
        }

        const deleteResponse = await deleteLocalFile(
            deletedTemplate.public_id || public_id || deletedTemplate.template || url
        );

        if (!deleteResponse || !["ok", "not found"].includes(deleteResponse.result)) {
            return res.status(500).json({ message: "Failed to delete stored file" });
        }

        if (req.user.role === "staff") {
            await User.findByIdAndUpdate(req.user._id, {
                $push: {
                    activities: {
                        activityType: "other",
                        details: {
                            staffId: req.user._id,
                            staffName: req.user.fullName,
                            action: `${req.user.fullName} deleted a template.`,
                            template: deletedTemplate._id,
                        },
                        reference: {
                            model: "Template",
                            id: deletedTemplate._id,
                        },
                        timestamp: new Date(),
                    },
                },
            });
        }

        return res.status(200).json({ message: "Image deleted successfully" });
    } catch (error) {
        console.error("Error deleting image:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export {
    uploadImage,
    getAllTemplates,
    deleteImage,
};
