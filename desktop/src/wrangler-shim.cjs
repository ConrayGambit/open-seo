// Preloaded into wrangler when it runs on Electron's Node (ELECTRON_RUN_AS_NODE).
// yargs treats any process with `process.versions.electron` and no
// `process.defaultApp` as a packaged Electron app and drops one fewer argv
// entry, so wrangler would read its own script path as a command.
process.defaultApp = true;
