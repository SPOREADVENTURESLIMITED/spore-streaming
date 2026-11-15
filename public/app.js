const catalogue = document.querySelector("#catalogue");
async function loadCatalogue() {
  try {
    const response = await fetch("/api/catalogue");
    if (!response.ok) throw new Error("Catalogue is not available yet");
    const data = await response.json();
    const items = data.items || [];
    catalogue.replaceChildren();
    if (!items.length) {
      catalogue.textContent = "New entertainment is coming soon. Check back shortly.";
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

const dialog = document.querySelector("#authDialog");
const authForm = document.querySelector("#authForm");
const authTitle = document.querySelector("#authTitle");
const authMessage = document.querySelector("#authMessage");
const authSubmit = document.querySelector("#authSubmit");
const authSwitch = document.querySelector("#authSwitch");
const nameField = document.querySelector("#nameField");
const accountButton = document.querySelector("#accountButton");
let registerMode = false;
function setAuthMode(register) {
  registerMode = register;
  authTitle.textContent = register ? "Create your account" : "Sign in";
  authSubmit.textContent = register ? "Create account" : "Sign in";
  authSwitch.textContent = register ? "Already have an account? Sign in" : "Create an account";
  nameField.hidden = !register;
  authForm.elements.password.autocomplete = register ? "new-password" : "current-password";
  authMessage.textContent = "";
}
accountButton.addEventListener("click", async () => {
  const response = await fetch("/api/auth/me");
  const data = await response.json();
  if (data.user) {
    authTitle.textContent = "Welcome, " + data.user.display_name;
    authMessage.textContent = data.user.email + " · " + data.user.role;
    authSubmit.hidden = true;
    authSwitch.textContent = "Sign out";
    nameField.hidden = true;
    dialog.showModal();
    return;
  }
  authSubmit.hidden = false;
  setAuthMode(false);
  dialog.showModal();
});
document.querySelector("#closeAuth").addEventListener("click", () => dialog.close());
authSwitch.addEventListener("click", async () => {
  if (authSubmit.hidden) {
    await fetch("/api/auth/logout", { method: "POST" });
    authSubmit.hidden = false;
    accountButton.textContent = "Sign in";
    dialog.close();
    return;
  }
  setAuthMode(!registerMode);
});
authForm.addEventListener("submit", async event => {
  event.preventDefault();
  authMessage.textContent = "Please wait…";
  authSubmit.disabled = true;
  const form = new FormData(authForm);
  const payload = Object.fromEntries(form.entries());
  try {
    const response = await fetch(registerMode ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to sign in.");
    accountButton.textContent = data.user.display_name;
    authTitle.textContent = "Welcome to SPORE MAX";
    authMessage.textContent = "You are signed in as " + data.user.email;
    authSubmit.hidden = true;
    authSwitch.textContent = "Sign out";
    nameField.hidden = true;
    authForm.elements.password.value = "";
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});
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
