const catalogue = document.querySelector("#catalogue");
async function loadCatalogue() {
  try {
    const response = await fetch("/api/catalogue");
    if (!response.ok) throw new Error("Catalogue is not available yet");
    const data = await response.json();
    const items = data.items || [];
    catalogue.replaceChildren();
    if (!items.length) {
      catalogue.innerHTML = "<p>New entertainment is coming soon. Check back shortly.</p>";
      return;
    }
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "tile";
      const type = document.createElement("small");
      type.textContent = item.media_type;
      const title = document.createElement("h3");
      title.textContent = item.title;
      card.append(type, title);
      catalogue.append(card);
    }
  } catch {
    catalogue.textContent = "The catalogue is being set up. Please check back soon.";
  }
}
let installPrompt;
const installButton = document.querySelector("#installButton");
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
loadCatalogue();