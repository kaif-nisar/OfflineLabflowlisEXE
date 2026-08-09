const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require("electron");

const APP_NAME = "LabFlow";
const APP_TITLE = APP_NAME;
const APP_ID = "com.labflow.desktop";
const APP_DESCRIPTION = "LabFlow - Advanced Pathology Software";

let mainWindow = null;
let isQuitting = false;

const getDiagnosticLogPath = () => path.join(app.getPath("userData"), "logs", "desktop-startup.log");

const writeDiagnosticLog = (event, error = null) => {
    try {
        const logPath = getDiagnosticLogPath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const details = error?.stack || error?.message || (error ? String(error) : "");
        fs.appendFileSync(
            logPath,
            `[${new Date().toISOString()}] ${event}${details ? `\n${details}` : ""}\n\n`,
            "utf8"
        );
        return logPath;
    } catch {
        return "";
    }
};

app.setName(APP_NAME);
if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

const getBundleRoot = () => {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "runtime-bundle");
    }

    return path.resolve(process.cwd());
};

const getWindowIconPath = () => {
    return path.join(getBundleRoot(), "public", "logoPng.png");
};

const getRuntimeRoot = () => {
    if (app.isPackaged) {
        return path.join(app.getPath("userData"), "runtime");
    }

    return path.resolve(process.cwd());
};

const sanitizeFileName = (fileName = "LabFlow-Report.pdf") => {
    const cleaned = String(fileName)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return "LabFlow-Report.pdf";
    }

    return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
};

const ensurePdfPreviewDir = () => {
    const previewDir = path.join(app.getPath("temp"), "LabFlow", "pdf-previews");
    fs.mkdirSync(previewDir, { recursive: true });
    return previewDir;
};

const ensureWindowsShortcuts = () => {
    if (process.platform !== "win32" || !app.isPackaged) {
        return;
    }

    const shortcutDetails = {
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        description: APP_DESCRIPTION,
        icon: process.execPath,
        iconIndex: 0,
        appUserModelId: APP_ID,
    };

    const desktopShortcutPath = path.join(app.getPath("desktop"), `${APP_NAME}.lnk`);
    const startMenuShortcutPath = path.join(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        `${APP_NAME}.lnk`
    );

    [desktopShortcutPath, startMenuShortcutPath].forEach((shortcutPath) => {
        try {
            if (fs.existsSync(shortcutPath)) {
                return;
            }

            fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
            shell.writeShortcutLink(shortcutPath, "create", shortcutDetails);
        } catch (error) {
            console.warn(`Unable to create shortcut at ${shortcutPath}`);
            console.warn(error?.stack || error?.message || error);
        }
    });
};

const configureRuntimeEnvironment = () => {
    const runtimeRoot = getRuntimeRoot();
    const bundleRoot = getBundleRoot();
    const mongoPort = String(process.env.LABFLOW_MONGO_PORT || "27027").trim() || "27027";

    process.env.LABFLOW_RUNTIME = "desktop";
    process.env.OFFLINE_MODE = "true";
    process.env.LABFLOW_MANAGED_MONGO = "true";
    process.env.LABFLOW_MONGO_PORT = mongoPort;
    process.env.MONGODB_URI = `mongodb://127.0.0.1:${mongoPort}/myfranchisee_super_admin`;
    process.env.LABFLOW_RUNTIME_ROOT = runtimeRoot;
    process.env.LABFLOW_BUNDLE_DIR = bundleRoot;
    process.env.LABFLOW_ROOT_DIR = runtimeRoot;

    return {
        runtimeRoot,
        bundleRoot,
        mongoPort,
    };
};

const createSplashMarkup = () => {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${APP_TITLE}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #0f766e;
      --border: rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at top, rgba(15, 118, 110, 0.12), transparent 36%),
        linear-gradient(180deg, #f8fbff 0%, var(--bg) 100%);
      color: var(--text);
    }
    .card {
      width: min(460px, calc(100vw - 48px));
      padding: 32px 28px;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid var(--border);
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      letter-spacing: -0.03em;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
      font-size: 15px;
    }
    .loader {
      display: flex;
      gap: 10px;
      margin-top: 24px;
      align-items: center;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: var(--accent);
      animation: pulse 1.2s infinite ease-in-out;
    }
    .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-4px); }
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>${APP_TITLE}</h1>
    <p>Preparing the offline database, services, and application window. This usually takes a few seconds.</p>
    <div class="loader" aria-hidden="true">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  </main>
</body>
</html>`;
};

const createMainWindow = () => {
    const nextWindow = new BrowserWindow({
        title: APP_TITLE,
        width: 1440,
        height: 960,
        minWidth: 1180,
        minHeight: 760,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#f4f7fb",
        icon: getWindowIconPath(),
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    nextWindow.removeMenu();
    // This is a desktop window without browser chrome. Keep familiar reload
    // shortcuts available for source-code testing, but never in packaged builds.
    if (!app.isPackaged) {
        nextWindow.webContents.on("before-input-event", (event, input) => {
            const reloadShortcut = input.type === "keyDown" && (
                input.key === "F5" ||
                ((input.control || input.meta) && String(input.key).toLowerCase() === "r")
            );
            if (!reloadShortcut) return;

            event.preventDefault();
            if (input.shift || input.key === "F5") {
                nextWindow.webContents.reloadIgnoringCache();
            } else {
                nextWindow.webContents.reload();
            }
        });
    }
    nextWindow.on("page-title-updated", (event) => {
        event.preventDefault();
        nextWindow.setTitle(APP_TITLE);
    });

    nextWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) {
            return { action: "allow" };
        }

        void shell.openExternal(url);
        return { action: "deny" };
    });

    nextWindow.webContents.on("will-navigate", (event, url) => {
        if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) {
            return;
        }

        event.preventDefault();
        void shell.openExternal(url);
    });

    nextWindow.on("closed", () => {
        if (mainWindow === nextWindow) {
            mainWindow = null;
        }
    });

    nextWindow.on("ready-to-show", () => {
        nextWindow.setTitle(APP_TITLE);
    });

    return nextWindow;
};

const loadSplashScreen = async (targetWindow) => {
    const splashMarkup = createSplashMarkup();
    await targetWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(splashMarkup)}`);
    targetWindow.show();
};

const bootApplicationWindow = async () => {
    writeDiagnosticLog("Starting LabFlow desktop runtime.");
    configureRuntimeEnvironment();
    mainWindow = createMainWindow();
    await loadSplashScreen(mainWindow);

    const { startDesktopRuntime } = await import("../src/runtime/desktopRuntime.js");
    const runtimeState = await startDesktopRuntime();
    const appUrl = `http://127.0.0.1:${runtimeState.port || 4000}/franchiseelogin.html`;
    try {
        await mainWindow.loadURL(appUrl);
    } catch (loadErr) {
        const errStr = String(loadErr?.message || loadErr || "");
        if (loadErr?.code === "ERR_ABORTED" || errStr.includes("ERR_ABORTED") || errStr.includes("-3")) {
            console.log("Navigation redirected during startup, proceeding smoothly:", errStr);
        } else {
            throw loadErr;
        }
    }
    mainWindow.setTitle(APP_TITLE);
    mainWindow.show();
    writeDiagnosticLog("LabFlow desktop runtime started successfully.");
};

ipcMain.handle("labflow:save-and-open-pdf", async (_event, payload = {}) => {
    try {
        const bufferLike = payload?.buffer;
        if (!bufferLike) {
            throw new Error("PDF buffer was not provided.");
        }

        const previewDir = ensurePdfPreviewDir();
        const baseName = sanitizeFileName(payload?.fileName);
        const parsed = path.parse(baseName);
        const filePath = path.join(previewDir, `${parsed.name}-${Date.now()}${parsed.ext || ".pdf"}`);
        fs.writeFileSync(filePath, Buffer.from(bufferLike));

        const openError = await shell.openPath(filePath);
        if (openError) {
            throw new Error(openError);
        }

        return { success: true, filePath };
    } catch (error) {
        return {
            success: false,
            message: error?.message || "PDF could not be opened.",
        };
    }
});

app.on("second-instance", () => {
    if (!mainWindow) {
        return;
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.focus();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", (event) => {
    if (isQuitting) {
        return;
    }

    isQuitting = true;
    event.preventDefault();

    void (async () => {
        try {
            const { stopDesktopRuntime } = await import("../src/runtime/desktopRuntime.js");
            await stopDesktopRuntime();
        } catch (error) {
            console.error("Failed to stop the LabFlow desktop runtime cleanly.");
            console.error(error?.stack || error?.message || error);
        } finally {
            app.exit();
        }
    })();
});

app.whenReady()
    .then(async () => {
        Menu.setApplicationMenu(null);
        ensureWindowsShortcuts();

        try {
            await bootApplicationWindow();
        } catch (error) {
            const logPath = writeDiagnosticLog("LabFlow startup failed.", error);
            console.error("Failed to launch the LabFlow desktop shell.");
            console.error(error?.stack || error?.message || error);
            dialog.showErrorBox(
                `${APP_TITLE} Startup Failed`,
                `${error?.message || "The desktop shell could not start the application runtime."}${
                    logPath ? `\n\nSupport log: ${logPath}` : ""
                }`
            );
            app.exit(1);
        }

        app.on("activate", async () => {
            if (BrowserWindow.getAllWindows().length > 0) {
                return;
            }

            try {
                await bootApplicationWindow();
            } catch (error) {
                console.error("Failed to reopen the LabFlow desktop shell.");
                console.error(error?.stack || error?.message || error);
            }
        });
    })
    .catch((error) => {
        writeDiagnosticLog("Electron startup failed.", error);
        console.error("Electron startup failed.");
        console.error(error?.stack || error?.message || error);
        app.exit(1);
    });
