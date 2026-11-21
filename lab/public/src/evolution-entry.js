import("./evolution-app.js").catch(() => {
  document.getElementById("ev-feedback").textContent = "O observatório não carregou. Atualize a página para tentar novamente.";
});
