import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { build, Platform, Arch } from "electron-builder";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const shouldBuildDir = args.has("--dir");
const shouldBuildPortable = args.has("--portable");
const shouldBuildSetup = args.has("--setup");
const shouldBuildAll = args.size === 0 || args.has("--all");
const requireSignature = args.has("--require-signature");

// Automatically fix version in package.json if user enters "2.0" instead of "2.0.0"
const pkgPath = path.join(root, "package.json");
if (fs.existsSync(pkgPath)) {
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        let ver = String(pkg.version || "1.0.0").trim();
        const parts = ver.split(".").map((p) => p.replace(/\D/g, "") || "0");
        while (parts.length < 3) {
            parts.push("0");
        }
        const normalizedVersion = parts.slice(0, 3).join(".");
        if (normalizedVersion !== pkg.version) {
            console.log(`Auto-correcting version format in package.json: "${pkg.version}" -> "${normalizedVersion}"`);
            pkg.version = normalizedVersion;
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        }
    } catch (e) {
        /* ignore parse errors */
    }
}

const assertSignedWindowsArtifact = (artifactPath) => {
    const signatureCheck = [
        "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
        "if ($signature.Status -ne 'Valid') {",
        "  Write-Error ('Unsigned or invalid signature: ' + $signature.Status + ' - ' + $signature.StatusMessage)",
        "  exit 1",
        "}",
        "Write-Output ('Verified publisher: ' + $signature.SignerCertificate.Subject)",
    ].join("; ");

    try {
        execFileSync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", signatureCheck, artifactPath],
            { stdio: "inherit" }
        );
    } catch {
        throw new Error(
            `Release signing verification failed for ${artifactPath}. Configure WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD with a valid code-signing certificate, then rebuild.`
        );
    }
};

const targets = [];
if (shouldBuildAll || shouldBuildDir) {
    targets.push("dir");
}

if (shouldBuildAll || shouldBuildSetup) {
    targets.push("nsis");
}

if (shouldBuildAll || shouldBuildPortable) {
    targets.push("portable");
}

const iconPath = path.join(root, "assets", "app-icon.ico");
if (!fs.existsSync(iconPath)) {
    console.warn("Desktop icon was not found at assets\\app-icon.ico.");
    console.warn("Run `npm run icon:create` before building if you want a branded Windows icon.");
}

console.log(`Building Electron targets: ${targets.join(", ")}`);

const artifacts = await build({
    projectDir: root,
    publish: "never",
    targets: Platform.WINDOWS.createTarget(targets, Arch.x64),
});

if (artifacts.length === 0) {
    console.log("Electron build completed. Directory targets do not always return artifact paths.");
} else {
    console.log("Electron build artifacts:");
    for (const artifactPath of artifacts) {
        console.log(`- ${path.relative(root, artifactPath)}`);
    }
}

if (requireSignature && shouldBuildSetup) {
    const setupArtifact = artifacts.find((artifactPath) => /-Setup-.*\.exe$/i.test(artifactPath));
    if (!setupArtifact) {
        throw new Error("Setup EXE was not found in the Electron build output.");
    }

    assertSignedWindowsArtifact(setupArtifact);
}
