/** Client-side only setup text. Call with a key held in React state, never persisted. */
export function buildCodexSetup(mcpUrl: string, key: string) {
  // Distinct names keep connections to different clubs from overwriting each other.
  const serverName = `kontor2_${new URL(mcpUrl).host.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const config = `[mcp_servers.${serverName}]
url = ${JSON.stringify(mcpUrl)}
enabled = true
http_headers = { "x-api-key" = ${JSON.stringify(key)} }`;

  const prompt = `Richte die folgende Kontor²-MCP-Verbindung dauerhaft für meinen lokalen Codex ein. Führe die Einrichtung aus.

Verwende die benutzerweite config.toml im aktiven CODEX_HOME (standardmäßig ~/.codex/config.toml), nicht eine Projektdatei. Sichere eine vorhandene Konfiguration mit denselben restriktiven Dateirechten. Ergänze oder aktualisiere nur den Eintrag ${serverName} samt dessen Untertabellen. Erhalte alle anderen Einstellungen und MCP-Verbindungen. Entferne bei diesem Eintrag widersprüchliche alte Transport- oder Authentifizierungsfelder. Speichere die Datei nur für meinen Benutzer lesbar. Der Schlüssel ist vertraulich: nicht in Ausgaben, Logs, Repository-Dateien oder Shell-History schreiben.

Konfiguration (TOML):
${config}

Prüfe anschließend, dass die gespeicherte TOML gültig ist und genau diese URL und diesen Header enthält, ohne den Schlüssel auszugeben. Prüfe die Verbindung mit MCP initialize und tools/list. Verwende ausschließlich lesende Protokollaufrufe; keine Vereinsdaten ändern. Melde getrennt, ob die Konfiguration gespeichert und die Verbindung geprüft wurde. Wenn die Werkzeuge in diesem Chat noch nicht verfügbar sind, teile mir mit, dass ich Codex neu starten oder einen neuen Chat öffnen muss. Behaupte keinen erfolgreichen Zugriff ohne Prüfung.`;

  return { serverName, config, prompt };
}
