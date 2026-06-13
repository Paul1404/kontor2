/**
 * Baut die Verbindung für einen Verein, der als eigene DB in der Primär-Instanz
 * liegt: Primär-URL übernehmen, nur den DB-Namen (Pfad) tauschen. Query-Parameter
 * (sslmode etc.) bleiben erhalten. Abhängigkeitsfrei -- bewusst ohne `src`-Importe,
 * damit auch schlanke Skripte dieselbe Logik nachbilden können.
 */
export function tenantUrlFromName(primaryUrl: string, databaseName: string): string {
  const u = new URL(primaryUrl);
  u.pathname = `/${databaseName}`;
  return u.toString();
}
