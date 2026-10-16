const $ = (id) => document.getElementById(id);
const firstRun = new URLSearchParams(location.search).get("firstRun") === "1";
const OPTIONAL_KEYS = [
  "OPENROUTER_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CONTEXT_API_KEY",
];
const SAVED = "Saved. Leave blank to keep it.";

function showAddresses() {
  const origin = `http://127.0.0.1:${$("port").value}`;
  $("mcp-url").textContent = `${origin}/mcp`;
  $("redirect-gsc").textContent = `${origin}/api/gsc/oauth/callback`;
  $("redirect-ga4").textContent = `${origin}/api/ga4/oauth/callback`;
}
$("port").addEventListener("input", showAddresses);

window.openseoDesktop.getSettings().then((settings) => {
  $("data-dir").textContent = settings.dataDir;
  $("port").value = settings.port;
  $("samModel").value = settings.samModel;
  showAddresses();
  for (const id of ["telemetryDisabled", "keepRunningInTray", "openAtLogin"]) {
    $(id).checked = settings[id];
  }
  if (settings.hasDataforseoKey) $("saved-dataforseo").textContent = SAVED;
  for (const key of OPTIONAL_KEYS) {
    if (settings.saved[key])
      document.querySelector(`[data-saved="${key}"]`).textContent = SAVED;
  }
  if (settings.builtInGoogle) {
    $("google-built-in").hidden = false;
    $("google-summary").textContent = "Use your own Google client (optional)";
  }
  if (settings.googleClientId) {
    $("GOOGLE_CLIENT_ID").placeholder = settings.googleClientId;
    $("google").open = true;
  }
  if (!firstRun) {
    $("title").textContent = "Settings";
    $("lead").textContent = "Saving restarts the local OpenSEO server.";
    $("save").textContent = "Save and restart";
  }
});

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").textContent = "";
  $("save").disabled = true;
  const keys = {};
  for (const key of OPTIONAL_KEYS) keys[key] = $(key).value;
  const result = await window.openseoDesktop.saveSettings({
    dataforseoKey: $("dataforseo").value,
    keys,
    telemetryDisabled: $("telemetryDisabled").checked,
    keepRunningInTray: $("keepRunningInTray").checked,
    openAtLogin: $("openAtLogin").checked,
    port: $("port").value,
    samModel: $("samModel").value,
  });
  if (!result.ok) {
    $("error").textContent = result.error;
    $("save").disabled = false;
  }
});
