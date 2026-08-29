export function renderErrorPage(requestId?: string): string {
  const ref = requestId
    ? `<p class="ref">Référence technique : <code>${requestId.replace(/[^a-zA-Z0-9-]/g, "")}</code></p>`
    : "";
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Page momentanément indisponible — PVIA</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 30rem; width: 100%; text-align: center; padding: 2rem 1.25rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .ref { font-size: 12px; color: #6b7280; margin: 1rem 0 0; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Page momentanément indisponible</h1>
      <p>Un incident technique nous empêche d'afficher cette page. Réessayez dans quelques instants. Si le problème persiste, revenez à l'accueil.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Réessayer</button>
        <a class="secondary" href="/">Retour à l'accueil</a>
        <a class="secondary" href="/login">Se connecter</a>
      </div>
      ${ref}
    </div>
  </body>
</html>`;
}
