// popup.js
//
// The popup is not a second copy of the panel. It exists for the two things a
// content script cannot do.
//
// It answers "is this working", which is otherwise indistinguishable from "this
// address has nothing to show". The footer states whether the backend answered,
// so a silent failure has somewhere to become visible.
//
// And it looks up an address you are not currently on, which is the case the
// content script by definition cannot cover.
//
// It reads the current tab's URL through activeTab, which Chrome grants only
// because you clicked the icon, rather than through the "tabs" permission,
// which would grant it for every tab all the time.

const out = document.getElementById("out");
const ctx = document.getElementById("context");
const statusEl = document.getElementById("status");

function factsHtml(f, p) {
  return `<div class="facts">
    <div><span>Polls stored</span><b>${fmtInt(f.polls)}</b></div>
    <div><span>Newest order seen</span><b>${fmtAge(f.newest_record_age_seconds)}</b></div>
    <div><span>Post-only seen</span><b>${fmtInt(p.alo_total)}</b></div>
  </div>`;
}

function renderAddress(data) {
  const f = data.freshness;
  const p = data.post_only;

  if (data.withheld_reason) {
    const w = WITHHELD[data.withheld_reason] || {
      title: "No rate available", body: "",
    };
    out.innerHTML = `
      <h2>${w.title}</h2>
      <p class="body">${w.body}</p>
      ${factsHtml(f, p)}
      <p class="note">No rate is shown rather than a rate you cannot rely on.</p>`;
    return;
  }

  const band = BANDS[p.band] || { label: p.band || "", colour: T.mint, body: "" };
  out.innerHTML = `
    <div class="rate-row">
      <div class="rate" style="color:${band.colour}">${fmtPct(p.rejection_rate)}</div>
      <div class="band" style="border-color:${band.colour};color:${band.colour}">${band.label}</div>
    </div>
    <p class="body">${band.body}</p>
    ${factsHtml(f, p)}
    <p class="note">${fmtInt(p.alo_rejected)} of ${fmtInt(p.alo_total)} post-only orders were
    refused before resting.</p>`;
}

async function show(address, source) {
  ctx.textContent = source;
  out.innerHTML = `<p class="muted">Reading measurements for ${address.slice(0, 10)}…</p>`;
  try {
    const data = await fetchAddress(address);
    renderAddress(data);
    statusEl.textContent = "Backend answered. Measurements are live.";
    statusEl.className = "ok";
  } catch (e) {
    out.innerHTML = `<h2>Cannot reach the measurements</h2>
      <p class="body">${String(e.message || e)}</p>
      <p class="note">This is a connection problem, not a statement about the address.</p>`;
    statusEl.textContent = "Backend did not answer.";
    statusEl.className = "bad";
  }
}

document.getElementById("lookup").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const v = document.getElementById("addr").value.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/.test(v)) {
    show(v, "Looked up by hand");
  } else {
    out.innerHTML = `<h2>That is not an address</h2>
      <p class="body">Expected 0x followed by 40 hexadecimal characters.</p>`;
  }
});

(async function init() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    tabs = [];
  }
  const url = (tabs[0] && tabs[0].url) || "";
  const address = addressFromUrl(url);

  if (address) {
    show(address, "From the tab you are on");
    return;
  }

  if (url.startsWith("https://app.hyperliquid.xyz/")) {
    ctx.textContent = "On Hyperliquid, but not an address page";
    out.innerHTML = `<h2>No address on this page</h2>
      <p class="body">Open an address under Explorer, or paste one below. The panel appears
      on pages whose address is in the URL, like
      <code>/explorer/address/0x…</code>.</p>`;
  } else {
    ctx.textContent = "Not on Hyperliquid";
    out.innerHTML = `<h2>Open a Hyperliquid address</h2>
      <p class="body">This works on app.hyperliquid.xyz address pages. You can also paste an
      address below without leaving this tab.</p>`;
  }
  statusEl.textContent = "Backend not checked yet. Look up an address to test it.";
})();
