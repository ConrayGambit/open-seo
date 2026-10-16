import { createFileRoute } from "@tanstack/react-router";
import { strToU8, zipSync } from "fflate";
import connectorSource from "../../../../integrations/wordpress/openseo-connector/openseo-connector.php?raw";

// The companion plugin as an installable zip (Plugins > Add New > Upload).
export const Route = createFileRoute("/api/wordpress/connector.zip")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          zipSync({
            "openseo-connector/openseo-connector.php": strToU8(connectorSource),
          }),
          {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition":
                'attachment; filename="openseo-connector.zip"',
            },
          },
        ),
    },
  },
});
