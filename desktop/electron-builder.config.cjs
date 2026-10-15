// electron-builder config for the Windows installer (NSIS, x64).
const { version } = require("../package.json");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "so.openseo.desktop",
  productName: "OpenSEO",
  executableName: "OpenSEO",
  // The desktop app versions with the OpenSEO app it bundles.
  extraMetadata: { version },
  directories: { output: "release", buildResources: "build-resources" },
  files: ["src/**/*", "package.json"],
  // wrangler spawns the workerd and esbuild binaries from node_modules, and
  // Windows cannot execute files packed inside an asar archive.
  asar: false,
  extraResources: [{ from: "build/openseo", to: "openseo" }],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/openseo/client/android-chrome-512x512.png",
    // Stamping the exe's icon and version needs Windows (or Wine). Builds
    // from Linux/macOS still produce a working installer, with Electron's
    // default exe icon.
    signAndEditExecutable: process.platform === "win32",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    // User data (database, settings) lives in %APPDATA%\OpenSEO and survives
    // uninstall unless the user removes it.
    deleteAppDataOnUninstall: false,
    artifactName: "OpenSEO-Setup-${version}.exe",
  },
};
