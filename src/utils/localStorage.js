import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import {
    DEFAULT_UPLOAD_SUBDIRECTORIES,
    resolveRuntimePath,
} from "./runtimePaths.js";

export const UPLOAD_ROOT = resolveRuntimePath("uploads");
export const UPLOAD_SUBDIRECTORIES = [...DEFAULT_UPLOAD_SUBDIRECTORIES];

const isWithinDirectory = (targetPath, directoryPath) => {
    const relativePath = path.relative(directoryPath, targetPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const sanitizeSegment = (value, fallback = "file") => {
    const sanitized = String(value || "")
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return sanitized || fallback;
};

const normalizeCategory = (category = "documents") => {
    return UPLOAD_SUBDIRECTORIES.includes(category) ? category : "documents";
};

const buildStoredFileMetadata = (category, fileName) => {
    const publicId = `${category}/${fileName}`;
    const publicUrl = `/uploads/${category}/${fileName}`;

    return {
        url: publicUrl,
        secure_url: publicUrl,
        public_id: publicId,
        path: path.join(UPLOAD_ROOT, category, fileName),
    };
};

const moveFile = async (sourcePath, destinationPath) => {
    try {
        await fsPromises.rename(sourcePath, destinationPath);
    } catch (error) {
        if (error?.code !== "EXDEV") {
            throw error;
        }

        await fsPromises.copyFile(sourcePath, destinationPath);
        await fsPromises.unlink(sourcePath);
    }
};

export const ensureUploadDirectoriesSync = () => {
    if (!fs.existsSync(UPLOAD_ROOT)) {
        fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    }

    for (const directoryName of UPLOAD_SUBDIRECTORIES) {
        const directoryPath = path.join(UPLOAD_ROOT, directoryName);
        if (!fs.existsSync(directoryPath)) {
            fs.mkdirSync(directoryPath, { recursive: true });
        }
    }
};

export const ensureUploadDirectories = async () => {
    await fsPromises.mkdir(UPLOAD_ROOT, { recursive: true });

    await Promise.all(
        UPLOAD_SUBDIRECTORIES.map((directoryName) =>
            fsPromises.mkdir(path.join(UPLOAD_ROOT, directoryName), { recursive: true })
        )
    );
};

const resolveStoredFilePath = (identifier) => {
    if (!identifier) {
        return null;
    }

    let normalizedIdentifier = String(identifier).trim();

    if (!normalizedIdentifier) {
        return null;
    }

    if (/^https?:\/\//i.test(normalizedIdentifier)) {
        try {
            const parsedUrl = new URL(normalizedIdentifier);
            normalizedIdentifier = parsedUrl.pathname;
        } catch (error) {
            return null;
        }
    }

    if (normalizedIdentifier.startsWith("/uploads/")) {
        normalizedIdentifier = normalizedIdentifier.slice("/uploads/".length);
    } else if (normalizedIdentifier.startsWith("uploads/")) {
        normalizedIdentifier = normalizedIdentifier.slice("uploads/".length);
    }

    if (path.isAbsolute(normalizedIdentifier)) {
        const absolutePath = path.normalize(normalizedIdentifier);
        return isWithinDirectory(absolutePath, UPLOAD_ROOT) ? absolutePath : null;
    }

    const candidatePath = path.normalize(path.join(UPLOAD_ROOT, normalizedIdentifier.replace(/\\/g, "/")));
    return isWithinDirectory(candidatePath, UPLOAD_ROOT) ? candidatePath : null;
};

export const resolveLocalStoredFilePath = (identifier) => {
    return resolveStoredFilePath(identifier);
};

export const normalizeStoredUploadUrl = (identifier) => {
    if (!identifier) {
        return "";
    }

    const resolvedPath = resolveStoredFilePath(identifier);
    if (!resolvedPath) {
        return "";
    }

    const relativePath = path.relative(UPLOAD_ROOT, resolvedPath).replace(/\\/g, "/");
    if (!relativePath || relativePath.startsWith("..")) {
        return "";
    }

    return `/uploads/${relativePath}`;
};

export const doesLocalFileExist = async (identifier) => {
    const filePath = resolveStoredFilePath(identifier);
    if (!filePath) {
        return false;
    }

    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
};

export const storeLocalFile = async (localFilePath, options = {}) => {
    if (!localFilePath) {
        throw new Error("Local file path is required for storage.");
    }

    await ensureUploadDirectories();

    const category = normalizeCategory(options.category);
    const sourcePath = path.resolve(localFilePath);
    const parsedName = path.parse(options.fileName || path.basename(sourcePath));
    const safeBaseName = sanitizeSegment(parsedName.name, "upload");
    const safeExtension = parsedName.ext
        ? `.${sanitizeSegment(parsedName.ext.slice(1), "bin")}`
        : path.extname(sourcePath);
    const finalFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeBaseName}${safeExtension}`;
    const destinationPath = path.join(UPLOAD_ROOT, category, finalFileName);

    await moveFile(sourcePath, destinationPath);

    return buildStoredFileMetadata(category, finalFileName);
};

export const deleteLocalFile = async (identifier) => {
    const filePath = resolveStoredFilePath(identifier);

    if (!filePath) {
        return { result: "not found" };
    }

    try {
        await fsPromises.unlink(filePath);
        return { result: "ok" };
    } catch (error) {
        if (error?.code === "ENOENT") {
            return { result: "not found" };
        }

        throw error;
    }
};

export const normalizeStoredUploadPublicId = (identifier) => {
    if (!identifier) return "";
    let normalized = String(identifier).trim().replace(/\\/g, "/");
    if (normalized.startsWith("/uploads/")) return normalized.slice(9);
    if (normalized.startsWith("uploads/")) return normalized.slice(8);
    return normalized;
};

ensureUploadDirectoriesSync();
