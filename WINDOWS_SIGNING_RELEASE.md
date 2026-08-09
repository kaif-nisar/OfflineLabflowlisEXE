# Windows SmartScreen: permanent release process

## Why the warning appears

`LabFlow-Setup-1.0.0.exe` is unsigned. Windows Defender SmartScreen therefore has no verified publisher identity and warns clients before it starts.

Do not send an unsigned setup file to clients as a final release.

## One-time requirement

Buy a Windows Authenticode code-signing certificate in the legal name that should appear to clients as the publisher. Use one stable company identity for every LabFlow release.

Keep the certificate and its password outside this project and outside Git. Never put them in `.env`, `package.json`, or source code.

## Configure the build computer

In a PowerShell window on the build computer, set these only for the current session:

```powershell
$env:WIN_CSC_LINK = "C:\Secure\LabFlow-CodeSigning.pfx"
$env:WIN_CSC_KEY_PASSWORD = "your-certificate-password"
```

If the certificate provider uses a hardware token or Microsoft Trusted Signing, use that provider's supported Windows signing setup instead of exporting a PFX file.

## Every client release

1. Increase `version` in `package.json`.
2. Build and require a valid signature:

```powershell
npm run release:setup
```

3. The command fails if the Setup EXE is unsigned or has an invalid signature.
4. Send only `release\electron\LabFlow-Setup-<version>.exe`.
5. Do not edit, zip-and-rewrite, or otherwise change the EXE after signing.

## Verify before sending

```powershell
Get-AuthenticodeSignature .\release\electron\LabFlow-Setup-<version>.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
```

`Status` must be `Valid` and the signer should show your company/legal publisher name.

## Important expectation

Signing identifies the publisher and lets trust accumulate across versions. A newly signed application can still show a SmartScreen warning until it gains reputation. Publishing through the Microsoft Store is the only distribution method that avoids these SmartScreen download warnings by design.
