const $ = (id) => document.getElementById(id);
const firstRun = new URLSearchParams(location.search).get("firstRun") === "1";

window.openseoDesktop.getSettings().then((settings) => {
  $("data-dir").textContent = settings.dataDir;
  $("telemetry").checked = settings.telemetryDisabled;
  if (settings.hasDataforseoKey) {
    $("dfs-saved").textContent = "A key is saved; leave blank to keep it.";
  }
  if (settings.hasOpenrouterKey) {
    $("or-saved").textContent = "A key is saved; leave blank to keep it.";
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
  const result = await window.openseoDesktop.saveSettings({
    dataforseoKey: $("dataforseo").value,
    openrouterKey: $("openrouter").value,
    telemetryDisabled: $("telemetry").checked,
  });
  if (!result.ok) {
    $("error").textContent = result.error;
    $("save").disabled = false;
  }
});
