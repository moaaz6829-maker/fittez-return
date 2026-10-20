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


var ADMIN_STORE = "fittezcap";

function productName(title) {
  if (!title || /^gid:\/\//.test(title)) return "Product";
  return title;
}

function productAdminUrl(gid) {
  if (!gid) return "";
  var id = String(gid).split("/").pop();
  return "https://admin.shopify.com/store/" + ADMIN_STORE + "/products/" + encodeURIComponent(id);
}

function productButton(gid, label) {
  var url = productAdminUrl(gid);
  if (!url) return "";
  return '<a class="btn btn-secondary btn-small" target="_blank" rel="noopener" href="' + escapeHtml(url) + '">' + escapeHtml(label || "Open product") + "</a>";
}


// ---------- Bosta helper: copy the original tracking number + open "create order" ----------

function bostaButton(kind, tracking) {
  var label = kind === "exchange" ? "Create exchange in Bosta" : "Create return in Bosta";
  return '<button class="btn btn-secondary" data-bosta="' + kind + '" data-track="' + escapeHtml(tracking || "") + '">' + label + "</button>";
}

function wireBostaButtons(container) {
  container.querySelectorAll("button[data-bosta]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var kind = btn.getAttribute("data-bosta");
      var tracking = btn.getAttribute("data-track") || "";
      var tab = kind === "exchange" ? "تبديل شحنات (Exchange)" : "إرجاع شحنة (Return)";
      function go(copied) {
        window.open("https://business.bosta.co/create-order", "_blank", "noopener");
        showNotice(
          (tracking
            ? (copied ? "Tracking number " + tracking + " copied. " : "Tracking number: " + tracking + ". ")
            : "This order has no tracking number on file. ") +
          "In Bosta choose the \"" + tab + "\" tab, paste the number in the first box and press Apply (تطبيق)."
        );
      }
      if (!tracking) { go(false); return; }
      try {
        navigator.clipboard.writeText(tracking).then(function () { go(true); }, function () {
          window.prompt("Copy the tracking number (Ctrl+C), then press OK:", tracking);
          go(false);
        });
      } catch (e) {
        window.prompt("Copy the tracking number (Ctrl+C), then press OK:", tracking);
        go(false);
      }
    });
  });
}

function cardField(label, valueHtml) {
  return '<div class="rc-field"><div class="rc-label">' + escapeHtml(label) + '</div><div class="rc-value">' + valueHtml + "</div></div>";
}

function badgeClass(status) {
  if (!status) return "badge-neutral";
  if (/FAILED|REJECTED|CANCELED/.test(status)) return "badge-critical";
  if (/COMPLETED|REFUNDED|DEDUCTED|APPROVED|_CREATED$|RETURNED_TO_BUSINESS/.test(status)) return "badge-success";
  if (/SHIPPED|PROGRESS/.test(status)) return "badge-info";
  if (/PENDING|REQUESTED|CREATING|CHECKED|AMBIGUOUS|NOT_STARTED/.test(status)) return "badge-warning";
  return "badge-neutral";
}

var STATUS_LABELS = {
  REQUESTED: "Pending approval",
  ELIGIBILITY_CHECKED: "Pending approval",
  BOSTA_CREATION_AMBIGUOUS: "Pending approval",
  CREATING_BOSTA_EXCHANGE: "Pending approval",
  BOSTA_EXCHANGE_CREATED: "Approved",
  REPLACEMENT_INVENTORY_DEDUCTED: "Approved",
  INVENTORY_SYNC_FAILED: "Approved – stock needs a retry",
  REPLACEMENT_SHIPPED: "Out for delivery",
  RETURN_IN_PROGRESS: "Out for delivery",
  RETURNED_TO_BUSINESS: "Returned",
  COMPLETED: "Delivered",
  PENDING: "Pending",
  APPROVED: "Approved",
  REFUNDED: "Refund sent",
  REJECTED: "Rejected",
  CANCELED: "Canceled",
  FAILED: "Failed"
};

function friendlyStatus(status) {
  if (!status) return "";
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  var t = String(status).replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function badge(status) {
  if (!status) return "";
  return '<span class="badge ' + badgeClass(status) + '">' + escapeHtml(friendlyStatus(status)) + "</span>";
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
    buttons.push(bostaButton("return", refund.originalTracking));
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

  container.innerHTML = refunds
    .map(function (r) {
      var items = (r.items || [])
        .map(function (it) {
          return (
            '<div class="rc-item"><div><strong>' + escapeHtml(productName(it.productTitle)) + "</strong>" +
            '<div class="muted">' + escapeHtml(it.variantTitle || "") + " × " + it.quantity + "</div></div>" +
            productButton(it.shopifyProductId, "Open product") + "</div>"
          );
        })
        .join("");

      return (
        '<div class="request-card">' +
        '<div class="rc-head"><div class="rc-title">Order ' + escapeHtml(r.shopifyOrderName) + "</div>" +
        '<div class="rc-head-right">' + badge(r.status) + '<span class="muted">' + fmtDate(r.createdAt) + "</span></div></div>" +
        '<div class="rc-body">' +
        cardField("Customer", escapeHtml(r.customerName || "—") + '<div class="muted">' + escapeHtml(r.customerPhone) + "</div>" +
          (r.customerEmail ? '<div class="muted">' + escapeHtml(r.customerEmail) + "</div>" : "")) +
        cardField("Original tracking", r.originalTracking ? '<a target="_blank" rel="noopener" href="https://bosta.co/tracking-shipment/?lang=en&trackingNumber=' + encodeURIComponent(r.originalTracking) + '">' + escapeHtml(r.originalTracking) + "</a>" : '<span class="muted">—</span>') +
        cardField("Items", items || "—") +
        cardField("Reason", escapeHtml((r.reason || "").replace(/_/g, " ")) + (r.otherReason ? '<div class="muted">' + escapeHtml(r.otherReason) + "</div>" : "")) +
        cardField("Payout to", escapeHtml(r.refundMethod || "—") + '<div class="muted">' + escapeHtml(r.refundMobile || "") + "</div>") +
        cardField("Amounts", "Subtotal " + egp(r.subtotal) + '<div class="muted">Fee −' + egp(r.refundFee) + "</div><strong>Refund " + egp(r.finalRefundAmount) + "</strong>") +
        "</div>" +
        '<div class="rc-actions">' + refundActionsHtml(r) + "</div>" +
        "</div>"
      );
    })
    .join("");

  container.querySelectorAll("button[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleRefundAction(btn.getAttribute("data-id"), btn.getAttribute("data-action"));
    });
  });
  wireBostaButtons(container);
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
  var b = [];
  function btn(cls, action, label) {
    b.push('<button class="btn ' + cls + '" data-action="' + action + '" data-id="' + ex.id + '">' + label + "</button>");
  }
  var st = ex.status;
  if (st === "REQUESTED" || st === "ELIGIBILITY_CHECKED" || st === "BOSTA_CREATION_AMBIGUOUS") {
    btn("btn-primary", "approve", "Approve");
    btn("btn-danger", "reject", "Reject");
  } else if (st === "REPLACEMENT_INVENTORY_DEDUCTED" || st === "BOSTA_EXCHANGE_CREATED") {
    b.push(bostaButton("exchange", ex.originalTracking));
    btn("btn-primary", "ship", "Out for delivery");
    btn("btn-secondary", "deliver", "Delivered");
    btn("btn-ghost", "tracking", ex.bostaTrackingNumber ? "Edit tracking" : "Add tracking");
  } else if (st === "REPLACEMENT_SHIPPED") {
    b.push(bostaButton("exchange", ex.originalTracking));
    btn("btn-primary", "deliver", "Delivered");
    btn("btn-ghost", "tracking", ex.bostaTrackingNumber ? "Edit tracking" : "Add tracking");
  }
  if (ex.inventoryStatus === "SYNC_FAILED" || st === "INVENTORY_SYNC_FAILED") {
    btn("btn-secondary", "retry-inventory", "Retry stock update");
  }
  return b.join(" ") || '<span class="muted">No actions</span>';
}

function pendingLabel(status) { return status; }

function renderExchanges(exchanges) {
  var container = document.getElementById("exchangesContainer");

  if (!exchanges.length) {
    container.innerHTML = '<div class="empty-state">No exchange requests yet.</div>';
    return;
  }

  container.innerHTML = exchanges
    .map(function (ex) {
      var items = (ex.items || [])
        .map(function (it) {
          return (
            '<div class="rc-item rc-swap">' +
            '<div class="rc-side"><div class="rc-label">Returns</div><strong>' + escapeHtml(productName(it.originalProductTitle)) + "</strong>" +
            '<div class="muted">' + escapeHtml(it.originalVariantTitle || "") + " × " + it.originalQuantity + "</div>" +
            productButton(it.originalProductId, "Open product") + "</div>" +
            '<div class="rc-arrow">→</div>' +
            '<div class="rc-side"><div class="rc-label">Wants</div><strong>' + escapeHtml(productName(it.replacementProductTitle)) + "</strong>" +
            '<div class="muted">' + escapeHtml(it.replacementVariantTitle || "") + " × " + it.replacementQuantity + "</div>" +
            productButton(it.replacementProductId, "Open product") + "</div>" +
            "</div>"
          );
        })
        .join("");

      var payout = ex.refundMethod
        ? cardField("Credit payout", escapeHtml(ex.refundMethod) + '<div class="muted">' + escapeHtml(ex.refundMobile || "") + "</div><strong>" + egp(ex.refundAmount) + "</strong>")
        : "";

      var track = ex.bostaTrackingNumber
        ? cardField("New shipment tracking", '<a target="_blank" rel="noopener" href="https://bosta.co/tracking-shipment/?lang=en&trackingNumber=' + encodeURIComponent(ex.bostaTrackingNumber) + '">' + escapeHtml(ex.bostaTrackingNumber) + "</a>")
        : "";

      return (
        '<div class="request-card">' +
        '<div class="rc-head"><div class="rc-title">Order ' + escapeHtml(ex.shopifyOrderName) + "</div>" +
        '<div class="rc-head-right">' + badge(pendingLabel(ex.status)) + (ex.inventoryStatus ? badge("STOCK " + ex.inventoryStatus) : "") +
        '<span class="muted">' + fmtDate(ex.createdAt) + "</span></div></div>" +
        '<div class="rc-body">' +
        cardField("Customer", escapeHtml(ex.customerName || "—") + '<div class="muted">' + escapeHtml(ex.customerPhone) + "</div>" +
          (ex.customerEmail ? '<div class="muted">' + escapeHtml(ex.customerEmail) + "</div>" : "")) +
        cardField("Location", escapeHtml(ex.governorate) + '<div class="muted">' + escapeHtml(ex.zone) + "</div>") +
        cardField("Original tracking", ex.originalTracking ? '<a target="_blank" rel="noopener" href="https://bosta.co/tracking-shipment/?lang=en&trackingNumber=' + encodeURIComponent(ex.originalTracking) + '">' + escapeHtml(ex.originalTracking) + "</a>" : '<span class="muted">—</span>') +
        '<div class="rc-field rc-wide"><div class="rc-label">Items</div><div class="rc-value">' + (items || "—") + "</div></div>" +
        cardField("Price", "Returned " + egp(ex.returnedTotal) + '<div>New ' + egp(ex.replacementTotal) + '</div><div class="muted">Difference ' + egp(ex.priceDifference) + "</div>") +
        cardField("Fee / Collect / Credit", "Fee " + egp(ex.exchangeFeeEgp) + "<div><strong>COD " + egp(ex.cod) + "</strong></div><div>Credit " + egp(ex.customerCredit) + "</div>") +
        payout +
        track +
        "</div>" +
        '<div class="rc-actions">' + exchangeActionsHtml(ex) + "</div>" +
        "</div>"
      );
    })
    .join("");

  container.querySelectorAll("button[data-action='approve']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleExchangeApprove(btn);
    });
  });
  container.querySelectorAll("button[data-action='reject']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleExchangeReject(btn.getAttribute("data-id"));
    });
  });
  wireBostaButtons(container);
  container.querySelectorAll("button[data-action='ship']").forEach(function (btn) {
    btn.addEventListener("click", function () { handleExchangeShip(btn); });
  });
  container.querySelectorAll("button[data-action='deliver']").forEach(function (btn) {
    btn.addEventListener("click", function () { handleExchangeDeliver(btn); });
  });
  container.querySelectorAll("button[data-action='tracking']").forEach(function (btn) {
    btn.addEventListener("click", function () { handleExchangeTracking(btn.getAttribute("data-id")); });
  });
  container.querySelectorAll("button[data-action='retry-inventory']").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleRetryInventory(btn.getAttribute("data-id"));
    });
  });
}

function findExchange(id) {
  return (state.exchanges || []).filter(function (e) { return e.id === id; })[0] || {};
}

async function exchangeCall(btn, path, body, okMessage, busyText) {
  btn.disabled = true;
  if (busyText) btn.textContent = busyText;
  try {
    await fittezApi("/api/admin/exchanges/" + btn.getAttribute("data-id") + "/" + path, { method: "POST", body: body || {} });
    showNotice(okMessage);
  } catch (err) {
    showError(err.message);
  }
  loadExchanges();
}

async function handleExchangeApprove(btn) {
  var tracking = window.prompt(
    "Approve this exchange?\n\nThis takes the new item out of stock and emails the customer.\n\nOptional: paste the Bosta tracking number of the new shipment (you can also add it later):",
    ""
  );
  if (tracking === null) return;
  exchangeCall(btn, "approve", { trackingNumber: tracking.trim() || undefined }, "Approved. Stock was updated and the customer was emailed.", "Approving…");
}

async function handleExchangeShip(btn) {
  var ex = findExchange(btn.getAttribute("data-id"));
  var tracking = ex.bostaTrackingNumber || "";
  if (!tracking) {
    var t = window.prompt("Mark as out for delivery and email the customer?\n\nOptional: Bosta tracking number for the link in the email:", "");
    if (t === null) return;
    tracking = t.trim();
  } else if (!window.confirm("Mark as out for delivery and email the customer?")) {
    return;
  }
  exchangeCall(btn, "out-for-delivery", { trackingNumber: tracking || undefined }, "Marked out for delivery. The customer was emailed.", "Saving…");
}

async function handleExchangeDeliver(btn) {
  if (!window.confirm("Mark as delivered and email the customer?")) return;
  exchangeCall(btn, "delivered", {}, "Marked as delivered. The customer was emailed.", "Saving…");
}

async function handleExchangeTracking(id) {
  var ex = findExchange(id);
  var t = window.prompt("Bosta tracking number for the new shipment:", ex.bostaTrackingNumber || "");
  if (t === null || !t.trim()) return;
  try {
    await fittezApi("/api/admin/exchanges/" + id + "/tracking", { method: "POST", body: { trackingNumber: t.trim() } });
    showNotice("Tracking number saved.");
  } catch (err) {
    showError(err.message);
  }
  loadExchanges();
}

async function handleExchangeReject(id) {
  var notes = window.prompt("Reason for rejection (shown to the customer, optional):", "");
  if (notes === null) return;
  try {
    await fittezApi("/api/admin/exchanges/" + id + "/reject", { method: "POST", body: { notes: notes || undefined } });
    showNotice("Exchange rejected and the customer was emailed.");
    loadExchanges();
  } catch (err) {
    showError(err.message);
  }
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
