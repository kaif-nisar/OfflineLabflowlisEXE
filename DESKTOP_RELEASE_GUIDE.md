# LabFlow Desktop Release Guide

## Recommended Release Flow

1. Update your code, UI, or backend logic in the source files.
2. If the brand logo changes, run `npm run icon:create`.
3. For day-to-day coding, run the app directly in Electron:
   `npm run dev`
4. For a clean release-like check, build an unpacked app:
   `npm run build:electron:dir`
5. Test the unpacked build from:
   `release/electron/win-unpacked/LabFlow.exe`
6. When testing looks good, increase `version` in `package.json` and build the installer:
   `npm run build:electron:setup`
7. Deliver the setup file from:
   `release/electron/LabFlow-Setup-<version>.exe`

## What To Send To The Client

Best option:
- Send the setup file.

Why:
- installs like normal Windows software
- uses the LabFlow app name and icon
- creates desktop and Start menu shortcuts
- can be searched from Windows search
- can be pinned to the taskbar manually

Optional option:
- Build portable only if the client specifically wants a no-install version:
  `npm run build:electron:portable`

## Future Upgrade Flow

1. Open the project folder in your IDE.
2. Change frontend files such as `private/pages/...`, `public/...`, or styles as needed.
3. Change backend or Electron files such as `src/...`, `app.js`, or `electron/...` if you are adding features.
4. Test in source mode if needed.
5. Build the unpacked desktop app with `npm run build:electron:dir`.
6. Open `release/electron/win-unpacked/LabFlow.exe` and verify login, navigation, reports, PDF, upload, and printing.
7. Increase `version` in `package.json` before final delivery.
8. Build the installer with `npm run build:electron:setup`.
9. Send only the new setup file to the client.
10. Ask the client to install the new setup over the old LabFlow install.

## Important Notes

- Do not send the raw source folder to the client.
- Prefer the setup build over the portable build for real users.
- Windows does not reliably allow apps to auto-pin themselves to the taskbar, so keep taskbar pinning as a manual user step.
- If a rebuild fails because an old build folder is locked, close any running LabFlow build and rebuild again. If needed, build to a fresh output folder for verification first.
- The setup is a per-user installation: it does not require Administrator permission. Existing older per-machine installs may still need to be uninstalled with Administrator permission once before moving to this format.
- If the installed app fails to open, send support this log file: `%APPDATA%\\LabFlow\\logs\\desktop-startup.log`.

## Client-PC Compatibility

- Support Windows 10/11, 64-bit only. The package is built for x64 Windows.
- Always digitally sign the final setup EXE with an Authenticode code-signing certificate. Unsigned 476 MB installers are commonly blocked or warned about by Windows SmartScreen and antivirus software.
- Do not distribute the portable build as the default. Give clients only the setup EXE and its SHA-256 checksum.

## Before Final Delivery

Verify these on a clean Windows machine:
- startup works
- login works
- `Enter Result` opens in the same app window
- PDF button opens the generated PDF
- search shows `LabFlow`
- desktop shortcut is created
- taskbar icon uses the LabFlow icon after install
