# Building and downloading MARS PRO V3 for Windows

## Recommended: download the GitHub Actions build

You do not need Node.js or Visual Studio to install an Actions build.

1. Open the repository on GitHub.
2. Select **Actions**.
3. Open the latest successful **Windows Installer** run.
4. In the **Artifacts** section, download `MARS-PRO-V3-Windows-<run number>`.
5. Extract the downloaded ZIP.
6. Run the installer EXE for a normal installation, or the portable EXE without installing.
7. Compare the EXE SHA-256 value with `SHA256SUMS.txt` before running it.

Artifacts are retained for 30 days. Tagged versions are also attached permanently to the repository's **Releases** page.

> Current builds are unsigned development builds. Windows SmartScreen may display an unknown-publisher warning. Do not distribute production builds until code signing is configured.

## Trigger a fresh build

After the workflow is merged into `main`:

1. Open **Actions** → **Windows Installer**.
2. Select **Run workflow**.
3. Choose `main` and confirm.
4. Wait for the green check mark, then download the artifact.

## Build locally on Windows

Requirements:

- Windows 10/11 x64
- Node.js 22 LTS
- npm 10 or newer
- Git

PowerShell commands:

```powershell
git clone https://github.com/ayushchandra860-bit/MARS.git
cd MARS
npm ci
npm run package
```

The generated installer and portable executable will be placed in the `release` directory.

## Development mode

```powershell
npm ci
npm run dev
```

## Verification performed by packaging

`npm run package` performs the following before producing an EXE:

1. Runs the Vitest suite once.
2. Cleans old generated output.
3. Typechecks both Electron and frontend TypeScript.
4. Builds the renderer and Electron processes.
5. Verifies required build artifacts exist.
6. Packages NSIS installer and portable Windows x64 executables.

A failed test, typecheck, build, or artifact verification prevents installer creation.
