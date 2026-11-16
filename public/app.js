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
    accountButton.textContent = data.user.display_name;
    await showDashboard();
    if (data.user.role === "admin") await showAdmin();
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
    document.querySelector("#customerDashboard").hidden = true;
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
  if (payload.mfa_code) { if (/^\\d{6}$/.test(payload.mfa_code)) payload.totp_code = payload.mfa_code; else payload.recovery_code = payload.mfa_code; }
  delete payload.mfa_code;
  try {
    const response = await fetch(registerMode ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) { if (data.mfa_required) { document.querySelector("#mfaCodeField").hidden = false; authMessage.textContent = "Enter your authenticator code or an unused recovery code, then submit again."; } throw new Error(data.error || "Unable to sign in."); }
    accountButton.textContent = data.user.display_name;
    authTitle.textContent = "Welcome to SPORE MAX";
    authMessage.textContent = "You are signed in as " + data.user.email;
    authSubmit.hidden = true;
    authSwitch.textContent = "Sign out";
    nameField.hidden = true;
    authForm.elements.password.value = "";
    dialog.close();
    await showDashboard();
    if (data.user.role === "admin") await showAdmin();
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

const dashboard = document.querySelector("#customerDashboard");
function renderRows(target, items, emptyText) {
  target.replaceChildren();
  if (!items.length) { target.textContent = emptyText; return; }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "dashboard-row";
    const name = document.createElement("strong");
    name.textContent = item.title;
    const detail = document.createElement("small");
    detail.textContent = item.media_type + (item.progress_seconds != null ? " · " + item.progress_seconds + " sec watched" : "");
    row.append(name, detail);
    target.append(row);
  }
}
async function showDashboard() {
  const response = await fetch("/api/account/dashboard");
  if (response.status === 401) { dashboard.hidden = true; return; }
  if (!response.ok) throw new Error("Dashboard could not be loaded.");
  const data = await response.json();
  const summary = document.querySelector("#dashboardSummary");
  summary.replaceChildren();
  const welcome = document.createElement("p");
  welcome.textContent = data.user.display_name + " · " + data.user.email;
  const plan = document.createElement("p");
  plan.textContent = data.subscription ? "Subscription: " + data.subscription.plan_code + " (" + data.subscription.status + ")" : "Plan: Free";
  summary.append(welcome, plan);
  renderRows(document.querySelector("#watchlistItems"), data.watchlist, "Your watchlist is empty.");
  renderRows(document.querySelector("#historyItems"), data.history, "No viewing history yet.");
  dashboard.hidden = false;
  dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
}
document.querySelector("#refreshDashboard").addEventListener("click", () => showDashboard().catch(() => {}));


const adminPanel = document.querySelector("#adminDashboard");
function adminNode(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
async function showAdmin() {
  const response = await fetch("/api/admin/dashboard");
  if (!response.ok) {
    adminPanel.hidden = true;
    throw new Error(response.status === 403 ? "Administrator access required." : "Admin dashboard unavailable.");
  }
  const data = await response.json();
  const stats = document.querySelector("#adminStats");
  stats.replaceChildren();
  for (const [label,value] of Object.entries(data.stats)) {
    const card = document.createElement("div");
    card.className = "admin-stat";
    card.append(adminNode("strong",String(value)),adminNode("span",label));
    stats.append(card);
  }
  const titles = document.querySelector("#adminTitles");
  titles.replaceChildren();
  for (const item of data.titles) {
    const row = document.createElement("div");
    row.className = "dashboard-row";
    const title = adminNode("strong",item.title + " · " + item.status);
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    if (item.status !== "published") {
      const publish = adminNode("button","Publish");
      publish.type = "button"; publish.className = "install";
      publish.addEventListener("click",() => updateTitle(item.id,{status:"published"}));
      actions.append(publish);
    } else {
      const draft = adminNode("button","Unpublish");
      draft.type = "button"; draft.className = "install";
      draft.addEventListener("click",() => updateTitle(item.id,{status:"draft"}));
      actions.append(draft);
    }
    const archive = adminNode("button","Archive");
    archive.type = "button"; archive.className = "install";
    archive.addEventListener("click",() => updateTitle(item.id,{status:"archived"}));
    actions.append(archive);
    row.append(title,adminNode("small",item.media_type+" · "+item.access_tier),actions);
    titles.append(row);
  }
  await loadAdminUsers();
  await loadMfaStatus();
  adminPanel.hidden = false;
}
async function updateTitle(id, changes) {
  const response = await fetch("/api/admin/titles/"+encodeURIComponent(id),{
    method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(changes)
  });
  if (!response.ok) { alert("Could not update this title."); return; }
  await showAdmin();
}
async function loadAdminUsers() {
  const response = await fetch("/api/admin/users");
  if (!response.ok) return;
  const data = await response.json();
  const target = document.querySelector("#adminUsers");
  target.replaceChildren();
  for (const user of data.users) {
    const row = document.createElement("div");
    row.className = "dashboard-row";
    row.append(adminNode("strong",user.display_name+" · "+user.email),adminNode("small",user.role+" · "+user.status));
    if (user.role !== "admin") {
      const button = adminNode("button",user.status === "suspended" ? "Reactivate" : "Suspend");
      button.type = "button"; button.className = "install";
      button.addEventListener("click",async()=>{
        const status = user.status === "suspended" ? "active" : "suspended";
        const result = await fetch("/api/admin/users/"+encodeURIComponent(user.id)+"/status",{
          method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status})
        });
        if (result.ok) await showAdmin();
      });
      row.append(button);
    }
    target.append(row);
  }
}

async function loadMfaStatus() {
  const response=await fetch("/api/admin/mfa/status");
  if(!response.ok) return;
  const data=await response.json();
  document.querySelector("#mfaStatus").textContent=data.enabled ? "MFA is enabled for this administrator." : "MFA is not enabled. Complete setup before using admin tools.";
  document.querySelector("#mfaSetup").hidden=data.enabled;
}
document.querySelector("#mfaSetup").addEventListener("click",async()=>{
  const response=await fetch("/api/admin/mfa/setup",{method:"POST"});
  const data=await response.json();
  if(!response.ok){document.querySelector("#mfaStatus").textContent=data.error||"MFA setup failed.";return;}
  document.querySelector("#mfaSecret").textContent=data.secret;
  document.querySelector("#mfaSetupDetails").hidden=false;
});
document.querySelector("#mfaEnable").addEventListener("click",async()=>{
  const code=document.querySelector("#mfaVerifyCode").value.trim();
  const response=await fetch("/api/admin/mfa/enable",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code})});
  const data=await response.json();
  if(!response.ok){document.querySelector("#mfaStatus").textContent=data.error||"MFA verification failed.";return;}
  document.querySelector("#mfaRecoveryCodes").textContent="Save these recovery codes securely. Each can be used once:\n"+data.recovery_codes.join("\n");
  document.querySelector("#mfaRecoveryCodes").hidden=false;
  await loadMfaStatus();
});

document.querySelector("#refreshAdmin").addEventListener("click",()=>showAdmin().catch(()=>{}));
document.querySelector("#adminLogout").addEventListener("click",async()=>{
  await fetch("/api/auth/logout",{method:"POST"});
  adminPanel.hidden=true;
  dashboard.hidden=true;
  accountButton.textContent="Sign in";
});
document.querySelector("#titleForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const message=document.querySelector("#adminMessage");
  const payload=Object.fromEntries(new FormData(form).entries());
  const response=await fetch("/api/admin/titles",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const data=await response.json();
  message.textContent=response.ok ? "Saved as draft." : (data.error || "Could not save title.");
  if(response.ok){form.reset();await showAdmin();}
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
