#!/usr/bin/env node
/**
 * LabFlow Database Backup Tool
 * Creates a distributable backup snapshot.
 * If ATLAS_MONGODB_URI is set, Atlas is used as the source.
 *
 * Usage: node create-backup.js
 * Creates: labflow-database-backup/ folder
 */

import { configDotenv } from "dotenv";
import { resolveRuntimePath } from "./src/utils/runtimePaths.js";
import { ensureLocalMongoReady } from "./src/utils/localMongoRuntime.js";
import { exportDatabaseBackup } from "./src/utils/databaseBackup.js";
import path from "path";
import fs from "fs";

configDotenv({ path: resolveRuntimePath(".env") });

async function main() {
    console.log("LabFlow Database Backup Tool");
    console.log("================================\n");

    try {
        const atlasMongoUri = String(process.env.ATLAS_MONGODB_URI || "").trim();
        const sourceUri = atlasMongoUri || String(process.env.MONGODB_URI || "").trim();
        const sourceType = atlasMongoUri ? "atlas" : "local";

        if (!sourceUri) {
            throw new Error("No MongoDB source URI is configured. Set ATLAS_MONGODB_URI or MONGODB_URI.");
        }

        if (atlasMongoUri) {
            console.log("1. Using Atlas as the backup source.\n");
        } else {
            console.log("1. Checking local MongoDB...");
            const mongoState = await ensureLocalMongoReady();
            if (!mongoState.managed && !mongoState.alreadyRunning) {
                throw new Error("Local MongoDB is not running. Please start it first.");
            }
            console.log("Local MongoDB is ready.\n");
        }

        const backupDir = resolveRuntimePath("labflow-database-backup");
        console.log(`2. Creating backup at: ${backupDir}`);

        if (fs.existsSync(backupDir)) {
            console.log("   Cleaning old backup files...");
            fs.rmSync(backupDir, { recursive: true, force: true });
        }

        fs.mkdirSync(backupDir, { recursive: true });
        console.log("Backup directory created.\n");

        console.log("3. Exporting database snapshot...");
        const manifest = await exportDatabaseBackup(backupDir, {
            sourceUri,
            sourceType,
            databaseNames: process.env.ATLAS_DATABASES || "",
        });
        console.log("Database snapshot exported successfully.\n");

        const manifestPath = path.join(backupDir, ".manifest.json");
        const updatedManifest = {
            ...manifest,
            labflowVersion: "offline",
            description: atlasMongoUri
                ? "LabFlow offline snapshot exported from Atlas for distribution"
                : "LabFlow offline snapshot exported from local MongoDB for distribution",
        };
        fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2));
        console.log("Manifest file created.\n");

        const backupSize = getDirectorySize(backupDir);
        console.log("BACKUP COMPLETE\n");
        console.log(`Backup Source: ${atlasMongoUri ? "Atlas" : "Local MongoDB"}`);
        console.log(`Backup Location: ${backupDir}`);
        console.log(`Backup Size: ${formatBytes(backupSize)}`);
        console.log(
            `Databases: ${(updatedManifest.databases || []).map((database) => database.name).join(", ")}`
        );
        console.log("\nNEXT STEPS:");
        console.log("   1. Copy the entire 'labflow-database-backup' folder");
        console.log("   2. Place it in the root directory of your distribution");
        console.log("   3. On first app launch, data will auto-restore if the local DB is empty\n");

        process.exit(0);
    } catch (error) {
        console.error("BACKUP FAILED!");
        console.error(error.message);
        process.exit(1);
    }
}

function getDirectorySize(dirPath) {
    let size = 0;
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            size += getDirectorySize(filePath);
        } else {
            size += stat.size;
        }
    });

    return size;
}

function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

main();
