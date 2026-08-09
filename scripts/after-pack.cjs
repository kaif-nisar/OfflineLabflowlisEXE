const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== "win32") {
        return;
    }

    const projectDir = process.cwd();
    const productFilename = context.packager.appInfo.productFilename;
    const version = context.packager.appInfo.version;
    const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
    const iconPath = path.join(projectDir, "assets", "app-icon.ico");
    const rceditPath = path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

    if (!fs.existsSync(exePath)) {
        throw new Error(`Branded executable not found at ${exePath}`);
    }

    if (!fs.existsSync(iconPath)) {
        throw new Error(`Application icon not found at ${iconPath}`);
    }

    if (!fs.existsSync(rceditPath)) {
        throw new Error(`rcedit was not found at ${rceditPath}`);
    }

    const args = [
        exePath,
        "--set-icon", iconPath,
        "--set-file-version", version,
        "--set-product-version", version,
        "--set-version-string", "CompanyName", "LabFlow",
        "--set-version-string", "FileDescription", "LabFlow - Advanced Pathology Software",
        "--set-version-string", "InternalName", productFilename,
        "--set-version-string", "OriginalFilename", `${productFilename}.exe`,
        "--set-version-string", "ProductName", "LabFlow",
    ];

    const result = spawnSync(rceditPath, args, { stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`rcedit failed with exit code ${result.status ?? "unknown"}`);
    }
};
