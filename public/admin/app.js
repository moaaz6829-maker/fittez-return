/* global fittezApi */

var state = {
  settings: null,
  refunds: null,
  exchanges: null,
  loaded: { analytics: false, refunds: false, exchanges: false, settings: false, shippingRates: false },
};

// ---------- small helpers ----------

function egp(value) {
  if (value === null || value === undefined || value === "") return "—";
  var n = parseFloat(value);
  if (isNaN(n)) return "—";
  return n.toFixed(2) + " EGP";
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch (err) {
    return iso;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeClass(status) {
  if (!status) return "badge-neutral";
  if (/FAILED|REJECTED|CANCELED|AMBIGUOUS/.test(status)) return "badge-critical";
  if (/COMPLETED|REFUNDED|DEDUCTED|APPROVED|_CREATED$|RETURNED_TO_BUSINESS/.test(status)) return "badge-success";
  if (/PENDING|REQUESTED|CREATING|PROGRESS|CHECKED|SHIPPED|NOT_STARTED/.test(status)) return "badge-warning";
  return "badge-neutral";
}

function badge(status) {
  if (!status) return "";
  return '<span class="badge ' + badgeClass(status) + '">' + escapeHtml(status.replace(/_/g, " ")) + "</span>";
}

function showError(message) {
  var el = document.getElementById("globalError");
  el.textContent = message;
  el.style.display = "block";
  document.getElementById("globalNotice").style.display = "none";
  window.scrollTo(0, 0);
}

function showNotice(message) {
  var el = document.getElementById("globalNotice");
  el.textContent = message;
  el.style.display = "block";
  document.getElementById("globalError").style.display = "none";
  window.scrollTo(0, 0);
  setTimeout(function () {
    el.style.display = "none";
  }, 4000);
}

function clearBanners() {
  document.getElementById("globalError").style.display = "none";
  document.getElementById("globalNotice").style.display = "none";
}

// ---------- modal ----------

function openModal(title, bodyHtml, onConfirm) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalBackdrop").style.display = "flex";

  var confirmBtn = document.getElementById("modalConfirm");
  var cancelBtn = document.getElementById("modalCancel");

  function cleanup() {
    document.getElementById("modalBackdrop").style.display = "none";
    confirmBtn.removeEventListener("click", onConfirmWrapped);
    cancelBtn.removeEventListener("click", onCancel);
  }

  function onCancel() {
    cleanup();
  }

  async function onConfirmWrapped() {
    confirmBtn.disabled = true;
    try {
      await onConfirm();
      cleanup();
    } catch (err) {
      showError(err.message);
    } finally {
      confirmBtn.disabled = false;
    }
  }

  confirmBtn.addEventListener("click", onConfirmWrapped);
  cancelBtn.addEventListener("click", onCancel);
}

// ---------- tabs ----------

function initTabs() {
  var buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = btn.getAttribute("data-tab");
      buttons.forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      document.querySelectorAll(".tab-panel").forEach(function (panel) {
        panel.classList.toggle("active", panel.id === "tab-" + tab);
      });
      clearBanners();
      if (tab === "analytics" && !state.loaded.analytics) loadAnalytics();
      if (tab === "refunds" && !state.loaded.refunds) loadRefunds();
      if (tab === "exchanges" && !state.loaded.exchanges) loadExchanges();
      if (tab === "settings" && !state.loaded.settings) loadSettingsTab();
    });
  });
}

// ---------- refunds ----------

async function loadRefunds() {
  var container = document.getElementById("refundsContainer");
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    var refunds = await fittezApi("/api/admin/refunds");
    state.loaded.refunds = true;
    state.refunds = refunds;
    renderRefunds(refunds);
  } catch (err) {
    container.innerHTML = "";
    showError("Failed to load refunds: " + err.message);
  }
}

function refundActionsHtml(refund) {
  var buttons = [];
  if (refund.status === "PENDING") {
    buttons.push('<button class="btn btn-primary" data-action="APPROVE" data-id="' + refund.id + '">Approve</button>');
    buttons.push('<button class="btn btn-danger" data-action="REJECT" data-id="' + refund.id + '">Reject</button>');
  } else if (refund.status === "APPROVED") {
    buttons.push('<button class="btn btn-primary" data-action="MARK_REFUNDED" data-id="' + refund.id + '">Mark Refunded</button>');
  } else if (refund.status === "REFUNDED") {
    buttons.push('<button class="btn btn-primary" data-action="MARK_COMPLETED" data-id="' + refund.id + '">Mark Completed</button>');
  }
  return buttons.join(" ") || '<span class="muted">—</span>';
}

function renderRefunds(refunds) {
  var container = document.getElementById("refundsContainer");

  if (!refunds.length) {
    container.innerHTML = '<div class="empty-state">No refund requests yet.</div>';
    return;
  }

  var rows = refunds
    .map(function (r) {
      var itemsList = (r.items || [])
        .map(function (it) {
          return "<li>" + escapeHtml(it.productTitle) + " — " + escapeHtml(it.variantTitle) + " ×" + it.quantity + "</li>";
        })
        .join("");

      return (
        "<tr>" +
        "<td>" + escapeHtml(r.shopifyOrderName) + "</td>" +
        "<td>" + escapeHtml(r.customerName || "—") + "<br/><span class=\"muted\">" + escapeHtml(r.customerPhone) + "</span></td>" +
        "<td><ul class=\"items-list\">" + itemsList + "</ul></td>" +
        "<td>" + escapeHtml((r.reason || "").replace(/_/g, " ")) + "</td>" +
        "<td>" + escapeHtml(r.refundMethod || "—") + "<br/><span class=\"muted\">" + escapeHtml(r.refundMobile || "") + "</span></td>" +
        "<td>" + egp(r.subtotal) + "</td>" +
        "<td>" + egp(r.refundFee) + "</td>" +
        "<td><strong>" + egp(r.finalRefundAmount) + "</strong></td>" +
        "<td>" + badge(r.status) + "</td>" +
        "<td>" + fmtDate(r.createdAt) + "</td>" +
        "<td>" + refundActionsHtml(r) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  container.innerHTML =
    "<table><thead><tr>" +
    "<th>Order</th><th>Customer</th><th>Items</th><th>Reason</th><th>Payout</th>" +
    "<th>Subtotal</th><th>Fee</th><th>Final Amount</th><th>Status</th><th>Created</th><th>Actions</th>" +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>";

  container.querySelectorAll("button[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleRefundAction(btn.getAttribute("data-id"), btn.getAttribute("data-action"));
    });
  });
}

async function handleRefundAction(id, action) {
  var notes;
  if (action === "REJECT") {
    notes = window.prompt("Reason for rejection (optional):", "") || undefined;
  }

  var confirmText = {
    APPROVE: "Approve this refund request?",
    REJECT: "Reject this refund request?",
    MARK_REFUNDED: "Mark this refund as paid out to the customer?",
    MARK_COMPLETED: "Mark this refund as fully completed?",
  }[action];

  if (!window.confirm(confirmText || "Are you sure?")) return;

  try {
    await fittezApi("/api/admin/refunds/" + id + "/action", {
      method: "POST",
      body: { action: action, notes: notes },
    });
    showNotice("Refund request updated.");
    loadRefunds();
  } catch (err) {
    showError(err.message);
  }
}

// ---------- exchanges ----------

async function loadExchanges() {
  var container = document.getElementById("exchangesContainer");
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    var exchanges = await fittezApi("/api/admin/exchanges");
    state.loaded.exchanges = true;
    state.exchanges = exchanges;
    renderExchanges(exchanges);
  } catch (err) {
    container.innerHTML = "";
    showError("Failed to load exchanges: " + err.message);
  }
}

function exchangeActionsHtml(ex) {
  var buttons = [];
  if (ex.status === "BOSTA_CREATION_AMBIGUOUS") {
    buttons.push('<button class="btn btn-primary" data-action="resolve" data-id="' + ex.id + '">Resolve</button>');
  }
  if (ex.inventoryStatus === "SYNC_FAILED" || ex.status === "INVENTORY_SYNC_FAILED") {
    buttons.push('<button class="btn btn-secondary" data-action="retry-inventory" data-id="' + ex.id + '">Retry Inventory</button>');
  }
  return buttons.join(" ") || '<span class="muted">—</span>';
}

function renderExchanges(exchanges) {
  var container = document.getElementById("exchangesContainer");

  if (!exchanges.length) {
    container.innerHTML = '<div class="empty-state">No exchange requests yet.</div>';
    return;
  }

  var rows = exchanges
    .map(function (ex) {
      var itemsList = (ex.items || [])
        .map(function (it) {
          return (
            "<li>" +
            escapeHtml(it.originalProductTitle) + " → " + escapeHtml(it.replacementProductTitle) +
            " (" + escapeHtml(it.replacementVariantTitle) + ")" +
            "</li>"
          );
        })
        .join("");

      return (
        "<tr>" +
        "<td>" + escapeHtml(ex.shopifyOrderName) + "</td>" +
        "<td>" + escapeHtml(ex.customerName || "—") + "<br/><span class=\"muted\">" + escapeHtml(ex.customerPhone) + "</span></td>" +
        "<td><ul class=\"items-list\">" + itemsList + "</ul></td>" +
        "<td>" + escapeHtml(ex.governorate) + "<br/><span class=\"muted\">" + escapeHtml(ex.zone) + "</span></td>" +
        "<td>" + egp(ex.priceDifference) + "</td>" +
        "<td>" + egp(ex.customerCredit) + "</td>" +
        "<td>" + egp(ex.cod) + "</td>" +
        "<td>" + badge(ex.status) + "</td>" +
        "<td>" + badge(ex.inventoryStatus) + "</td>" +
        "<td>" + escapeHtml(ex.bostaTrackingNumber || "—") + "</td>" +
        "<td>" + fmtDate(ex.createdAt) + "</td>" +
        "<td>" + exchangeActionsHtml(ex) + "</td>" +
        "</tr>"
      );
    })
    .join("");

  container.innerHTML =
    "<table><thead><tr>" +
    "<th>Order</th><th>Customer</th><th>Items</th><th>Location</th><th>Price Diff</th>" +
    "<th>Customer Credit</th><th>COD</th><th>Status</th><th>Inventory</th><th>Bosta Tracking</th><th>Created</th><th>Actions</th>" +
    "</tr></thead><tbody>" +
    rows +
    "</tbody></table>";

  container.querySelectorAll("button[data-action='resolve']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openResolveModal(btn.getAttribute("data-id"));
    });
  });
  container.querySelectorAll("button[data-action='retry-inventory']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleRetryInventory(btn.getAttribute("data-id"));
    });
  });
}

function openResolveModal(id) {
  var bodyHtml =
    '<div class="modal-body-row">' +
    '<label><input type="radio" name="resolveOutcome" value="SHIPMENT_EXISTS" checked /> ' +
    "The shipment DOES exist on Bosta (I checked the Bosta Dashboard)</label>" +
    "</div>" +
    '<div class="modal-body-row">' +
    "<label>Bosta Shipment ID</label>" +
    '<input type="text" id="resolveShipmentId" />' +
    "</div>" +
    '<div class="modal-body-row">' +
    "<label>Bosta Tracking Number</label>" +
    '<input type="text" id="resolveTrackingNumber" />' +
    "</div>" +
    '<div class="modal-body-row">' +
    '<label><input type="radio" name="resolveOutcome" value="SHIPMENT_NOT_CREATED" /> ' +
    "The shipment was NOT created (reset this request so it can be retried)</label>" +
    "</div>" +
    '<p class="form-hint">Bosta has no confirmed way to look this up automatically, so check the Bosta Dashboard yourself first.</p>';

  openModal("Resolve Ambiguous Bosta Creation", bodyHtml, async function () {
    var outcomeInput = document.querySelector('input[name="resolveOutcome"]:checked');
    var outcome = outcomeInput ? outcomeInput.value : null;
    var payload = { outcome: outcome };

    if (outcome === "SHIPMENT_EXISTS") {
      var bostaShipmentId = document.getElementById("resolveShipmentId").value.trim();
      var bostaTrackingNumber = document.getElementById("resolveTrackingNumber").value.trim();
      if (!bostaShipmentId || !bostaTrackingNumber) {
        throw new Error("Both the Shipment ID and Tracking Number are required.");
      }
      payload.bostaShipmentId = bostaShipmentId;
      payload.bostaTrackingNumber = bostaTrackingNumber;
    }

    await fittezApi("/api/admin/exchanges/" + id + "/resolve-ambiguous", {
      method: "POST",
      body: payload,
    });
    showNotice("Exchange request resolved.");
    loadExchanges();
  });
}

async function handleRetryInventory(id) {
  if (!window.confirm("Retry the replacement inventory deduction for this exchange?")) return;
  try {
    await fittezApi("/api/admin/inventory/retry", {
      method: "POST",
      body: { exchangeRequestId: id },
    });
    showNotice("Inventory retry triggered.");
    loadExchanges();
  } catch (err) {
    showError(err.message);
  }
}

// ---------- analytics ----------

async function loadAnalytics() {
  var container = document.getElementById("analyticsContainer");
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    var refunds = state.refunds || (await fittezApi("/api/admin/refunds"));
    var exchanges = state.exchanges || (await fittezApi("/api/admin/exchanges"));
    state.refunds = refunds;
    state.exchanges = exchanges;
    state.loaded.analytics = true;
    renderAnalytics(refunds, exchanges);
  } catch (err) {
    container.innerHTML = "";
    showError("Failed to load analytics: " + err.message);
  }
}

function sumWhere(list, statuses, field) {
  return list
    .filter(function (item) {
      return statuses.indexOf(item.status) !== -1;
    })
    .reduce(function (total, item) {
      var n = parseFloat(item[field]);
      return total + (isNaN(n) ? 0 : n);
    }, 0);
}

function countByField(list, field) {
  var counts = {};
  list.forEach(function (item) {
    var key = item[field] || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function barRowFillClass(status) {
  var cls = badgeClass(status);
  if (cls === "badge-critical") return "fill-critical";
  if (cls === "badge-warning") return "fill-warning";
  if (cls === "badge-neutral") return "fill-neutral";
  return "";
}

function renderBreakdown(title, counts, total) {
  var rows = Object.keys(counts)
    .sort(function (a, b) {
      return counts[b] - counts[a];
    })
    .map(function (status) {
      var count = counts[status];
      var pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return (
        '<div class="bar-row">' +
        '<span class="bar-label">' + escapeHtml(status.replace(/_/g, " ")) + "</span>" +
        '<span class="bar-track"><span class="bar-fill ' + barRowFillClass(status) + '" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-count">' + count + "</span>" +
        "</div>"
      );
    })
    .join("");

  return (
    '<div class="breakdown-card card">' +
    "<h3>" + escapeHtml(title) + "</h3>" +
    (rows || '<p class="muted">No data yet.</p>') +
    "</div>"
  );
}

function renderAnalytics(refunds, exchanges) {
  var container = document.getElementById("analyticsContainer");

  var refundedTotal = sumWhere(refunds, ["REFUNDED", "COMPLETED"], "finalRefundAmount");
  var pendingRefunds = refunds.filter(function (r) { return r.status === "PENDING"; }).length;

  var exchangeFeesCollected = sumWhere(
    exchanges,
    ["BOSTA_EXCHANGE_CREATED", "REPLACEMENT_INVENTORY_DEDUCTED", "REPLACEMENT_SHIPPED", "RETURN_IN_PROGRESS", "RETURNED_TO_BUSINESS", "COMPLETED"],
    "exchangeFeeEgp"
  );
  var needsAttention = exchanges.filter(function (ex) {
    return ex.status === "BOSTA_CREATION_AMBIGUOUS" || ex.status === "INVENTORY_SYNC_FAILED" || ex.inventoryStatus === "SYNC_FAILED";
  }).length;

  var statTiles =
    '<div class="stat-grid">' +
    '<div class="stat-tile"><div class="stat-label">Refund Requests</div><div class="stat-value">' + refunds.length + '</div><div class="stat-sub">' + pendingRefunds + ' pending</div></div>' +
    '<div class="stat-tile"><div class="stat-label">Paid Out (Refunds)</div><div class="stat-value">' + egp(refundedTotal) + '</div><div class="stat-sub">Refunded + Completed</div></div>' +
    '<div class="stat-tile"><div class="stat-label">Exchange Requests</div><div class="stat-value">' + exchanges.length + '</div><div class="stat-sub">' + needsAttention + ' need attention</div></div>' +
    '<div class="stat-tile"><div class="stat-label">Exchange Fees Collected</div><div class="stat-value">' + egp(exchangeFeesCollected) + "</div><div class=\"stat-sub\">From created/shipped exchanges</div></div>" +
    "</div>";

  var breakdown =
    '<div class="breakdown-grid">' +
    renderBreakdown("Refunds by Status", countByField(refunds, "status"), refunds.length) +
    renderBreakdown("Exchanges by Status", countByField(exchanges, "status"), exchanges.length) +
    "</div>";

  container.innerHTML = statTiles + breakdown;
}

// ---------- shipping rates (exchange fee by governorate) ----------

async function loadShippingRates() {
  var container = document.getElementById("shippingRatesContainer");
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    var rates = await fittezApi("/api/admin/shipping-rates");
    state.loaded.shippingRates = true;
    renderShippingRates(rates);
  } catch (err) {
    container.innerHTML = "";
    showError("Failed to load shipping rates: " + err.message);
  }
}

function renderShippingRates(rates) {
  var container = document.getElementById("shippingRatesContainer");

  if (!rates.length) {
    container.innerHTML = '<div class="empty-state">No governorates configured yet.</div>';
    return;
  }

  var rows = rates
    .map(function (rate) {
      var zoneCount = 1; // informational note below covers the shared-zone case
      return (
        "<tr>" +
        "<td>" + escapeHtml(rate.governorateName) + "</td>" +
        "<td>" + escapeHtml(rate.zone.name) + "</td>" +
        "<td>" +
        '<input type="number" step="0.01" class="shipping-rate-input" data-zone-id="' + rate.zone.id + '" value="' + escapeHtml(rate.zone.exchangeFeeEgp) + '" />' +
        " EGP" +
        "</td>" +
        "<td><button class=\"btn btn-primary\" data-action=\"save-zone-fee\" data-zone-id=\"" + rate.zone.id + "\">Save</button></td>" +
        "</tr>"
      );
    })
    .join("");

  container.innerHTML =
    '<p class="form-hint" style="padding:12px 12px 0">Governorates grouped into the same zone share one fee -- saving here updates every governorate in that zone.</p>' +
    "<table><thead><tr><th>Governorate</th><th>Zone</th><th>Exchange Fee</th><th></th></tr></thead><tbody>" +
    rows +
    "</tbody></table>";

  container.querySelectorAll("button[data-action='save-zone-fee']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var zoneId = btn.getAttribute("data-zone-id");
      var input = container.querySelector("input[data-zone-id='" + zoneId + "']");
      handleSaveZoneFee(zoneId, input.value, btn);
    });
  });
}

async function handleSaveZoneFee(zoneId, value, btn) {
  var fee = parseFloat(value);
  if (isNaN(fee) || fee <= 0) {
    showError("Enter a valid fee greater than zero.");
    return;
  }
  btn.disabled = true;
  try {
    await fittezApi("/api/admin/shipping-zones/" + zoneId, {
      method: "PATCH",
      body: { exchangeFeeEgp: fee },
    });
    showNotice("Exchange fee updated.");
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- settings ----------

async function loadSettingsTab() {
  var container = document.getElementById("settingsContainer");
  container.innerHTML = '<p class="loading">Loading…</p>';
  try {
    var settings = await fetchAndCacheSettings();
    state.loaded.settings = true;
    renderSettingsForm(settings);
  } catch (err) {
    container.innerHTML = "";
    showError("Failed to load settings: " + err.message);
  }
  loadShippingRates();
}

async function fetchAndCacheSettings() {
  var settings = await fittezApi("/api/admin/settings");
  state.settings = settings;
  syncTestModeHeader(settings);
  return settings;
}

function syncTestModeHeader(settings) {
  var toggle = document.getElementById("testModeToggle");
  var badgeEl = document.getElementById("testModeBadge");
  toggle.checked = !!settings.testModeEnabled;
  badgeEl.style.display = settings.testModeEnabled ? "inline-block" : "none";
}

function renderSettingsForm(settings) {
  var container = document.getElementById("settingsContainer");
  container.innerHTML =
    '<div class="form-row">' +
    "<label>Refund fee (EGP)</label>" +
    '<input type="number" step="0.01" id="setRefundFeeEgp" value="' + escapeHtml(settings.refundFeeEgp) + '" />' +
    "</div>" +
    '<div class="form-row">' +
    "<label>Inventory location ID</label>" +
    '<input type="text" id="setInventoryLocationId" value="' + escapeHtml(settings.inventoryLocationId || "") + '" />' +
    '<span class="form-hint">Shopify location GID, e.g. gid://shopify/Location/123</span>' +
    "</div>" +
    '<div class="form-row">' +
    "<label>Bosta business location ID</label>" +
    '<input type="text" id="setBostaBusinessLocationId" value="' + escapeHtml(settings.bostaBusinessLocationId || "") + '" />' +
    "</div>" +
    '<div class="form-row">' +
    "<label>Bosta webhook header name</label>" +
    '<input type="text" id="setBostaWebhookHeaderName" value="' + escapeHtml(settings.bostaWebhookHeaderName) + '" />' +
    '<span class="form-hint">Must match the custom header name configured in the Bosta Dashboard (webhookCustomHeaders). The header VALUE is the secret and is set via the BOSTA_WEBHOOK_SECRET server environment variable, never here.</span>' +
    "</div>" +
    '<div class="form-row">' +
    "<label>Inventory lock lease (ms)</label>" +
    '<input type="number" step="1" id="setInventoryLockLeaseMs" value="' + escapeHtml(settings.inventoryLockLeaseMs) + '" />' +
    '<span class="form-hint">How long a concurrency lock on a variant is held before it can be stolen by a crashed request.</span>' +
    "</div>" +
    '<button id="saveSettingsBtn" class="btn btn-primary">Save Settings</button>';

  document.getElementById("saveSettingsBtn").addEventListener("click", handleSaveSettings);
}

async function handleSaveSettings() {
  var payload = {
    refundFeeEgp: parseFloat(document.getElementById("setRefundFeeEgp").value),
    inventoryLocationId: document.getElementById("setInventoryLocationId").value.trim() || undefined,
    bostaBusinessLocationId: document.getElementById("setBostaBusinessLocationId").value.trim() || undefined,
    bostaWebhookHeaderName: document.getElementById("setBostaWebhookHeaderName").value.trim(),
    inventoryLockLeaseMs: parseInt(document.getElementById("setInventoryLockLeaseMs").value, 10),
  };

  var btn = document.getElementById("saveSettingsBtn");
  btn.disabled = true;
  try {
    var updated = await fittezApi("/api/admin/settings", { method: "PATCH", body: payload });
    state.settings = updated;
    showNotice("Settings saved.");
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleTestModeToggle(e) {
  var enabled = e.target.checked;
  try {
    var updated = await fittezApi("/api/admin/test-mode", { method: "POST", body: { enabled: enabled } });
    state.settings = updated;
    syncTestModeHeader(updated);
    showNotice(enabled ? "Test Mode enabled." : "Test Mode disabled.");
  } catch (err) {
    e.target.checked = !enabled; // revert on failure
    showError(err.message);
  }
}

async function handleTestBostaConnection() {
  var resultEl = document.getElementById("bostaTestResult");
  var btn = document.getElementById("testBostaConnection");
  btn.disabled = true;
  resultEl.textContent = "Testing…";
  try {
    var result = await fittezApi("/api/admin/bosta/test-connection", { method: "POST" });
    resultEl.innerHTML = '<span class="badge badge-success">OK</span> ' + escapeHtml(JSON.stringify(result));
  } catch (err) {
    resultEl.innerHTML = '<span class="badge badge-critical">Failed</span> ' + escapeHtml(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- init ----------

function init() {
  if (!window.shopify) {
    showError("App Bridge did not initialize. This page must be opened embedded inside Shopify Admin.");
    return;
  }

  initTabs();
  document.getElementById("refreshAnalytics").addEventListener("click", loadAnalytics);
  document.getElementById("refreshRefunds").addEventListener("click", loadRefunds);
  document.getElementById("refreshExchanges").addEventListener("click", loadExchanges);
  document.getElementById("refreshShippingRates").addEventListener("click", loadShippingRates);
  document.getElementById("testModeToggle").addEventListener("change", handleTestModeToggle);
  document.getElementById("testBostaConnection").addEventListener("click", handleTestBostaConnection);

  // Settings are fetched once up front purely to populate the header's
  // Test Mode toggle/badge, even if the Settings tab is never opened.
  fetchAndCacheSettings().catch(function (err) {
    showError("Failed to load settings: " + err.message);
  });

  loadAnalytics();
}

document.addEventListener("DOMContentLoaded", init);
