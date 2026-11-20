const params = new URLSearchParams(location.search);
  if (params.has("amostra") || params.get("modo") === "lagoa") location.replace("./lagoa.html" + location.search + location.hash);
  else import("./evolution-app.js").catch(() => {document.getElementById("ev-feedback").textContent="O laboratório não carregou. Atualize a página para tentar novamente.";});
