// electron-builder config for the Windows installer (NSIS, x64).
const { version } = require("../package.json");

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "so.openseo.desktop",
  productName: "OpenSEO",
  executableName: "OpenSEO",
  // The desktop app versions with the OpenSEO app it bundles.
  extraMetadata: { version },
  // No auto-update feed yet; installers are published by the GitHub workflow.
  publish: null,
  directories: { output: "release", buildResources: "build-resources" },
  files: [
    "src/**/*",
    "package.json",
    // Native binaries for other platforms, present when building off Windows.
    "!node_modules/@cloudflare/workerd-{linux,darwin}-*/**",
    "!node_modules/@esbuild/{linux,darwin}-*/**",
    "!node_modules/@img/*-{linux,linuxmusl,darwin}-*/**",
  ],
  // wrangler spawns the workerd and esbuild binaries from node_modules, and
  // Windows cannot execute files packed inside an asar archive.
  asar: false,
  extraResources: [{ from: "build/openseo", to: "openseo" }],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "build/openseo/client/android-chrome-512x512.png",
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
