import {decodeInstrument, insideInstrument, navigateFromInstrument} from "./instrument-route.js";

const route = decodeInstrument(location.href, location.href);
if (route && !insideInstrument()) {
  location.replace(route.shell.href);
} else if (route) {
  document.documentElement.classList.add("instrument-content");
  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    event.preventDefault();
    navigateFromInstrument(url.pathname + url.search + url.hash);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]") && !document.fullscreenElement) {
      navigateFromInstrument("./");
    }
  });
}
