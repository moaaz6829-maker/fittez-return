(function () {
  "use strict";

  var T = {
    en: {
      title: "Return or Exchange",
      subtitle: "Enter your order details to start. 3-day return or swap policy.",
      orderNo: "Order number", orderPh: "e.g. 1234",
      phone: "Phone number on the order", phonePh: "01xxxxxxxxx",
      continue: "Continue", back: "Back", checking: "Checking…", submitting: "Submitting…",
      fillBoth: "Please enter both the order number and the phone number.",
      network: "Connection problem. Please try again.",
      notEligible: "This order isn't eligible for return or exchange.",
      noItems: "There are no eligible items on this order.",
      saleNote: "Sale items can't be returned or exchanged and are not shown.",
      testMode: "Test mode",
      whatToDo: "What would you like to do?",
      refund: "Return", refundSub: "Get your money back",
      exchange: "Exchange", exchangeSub: "Swap for another size",
      pickItems: "Choose the items", qty: "Quantity", include: "Include",
      newSize: "New size / variant", loadingSizes: "Loading sizes…",
      outOfStock: "out of stock", noSizes: "No other sizes available.",
      pickOne: "Select at least one item.", pickSize: "Choose a replacement for each selected item.",
      reason: "Reason",
      r_WRONG_SIZE: "Wrong size", r_DOESNT_FIT: "Doesn't fit", r_CHANGED_MIND: "Changed my mind",
      r_NOT_AS_EXPECTED: "Not as expected", r_OTHER: "Other",
      otherReason: "Tell us more", needReason: "Please choose a reason.",
      payout: "Where should we send your refund?",
      eWallet: "E-wallet (Vodafone Cash, etc.)", instapay: "InstaPay",
      mobile: "Wallet / InstaPay mobile number",
      needPayout: "Please choose a payout method and enter the mobile number.",
      optPayout: "Only needed if your replacement costs less than the original (the difference is refunded).",
      refundFeeNote: "A fixed return fee is deducted from the refund, per FITTEZ policy.",
      exchangeFeeNote: "An exchange delivery fee based on your governorate is added. Our courier (Bosta) will collect the item and deliver the replacement.",
      review: "Review", submit: "Submit request",
      done: "Request received", reqNo: "Request number", tracking: "Tracking number",
      status: "Status", doneRefund: "We'll review your return and contact you about the refund.",
      doneExchange: "Your exchange is booked. Keep your tracking number handy.",
      another: "Start another request",
      item: "Item", type: "Type", total: "Items"
    },
    ar: {
      title: "استرجاع أو استبدال",
      subtitle: "اكتب بيانات الأوردر عشان نبدأ. سياسة الاسترجاع أو الاستبدال خلال 3 أيام.",
      orderNo: "رقم الأوردر", orderPh: "مثلاً 1234",
      phone: "رقم التليفون المسجل على الأوردر", phonePh: "01xxxxxxxxx",
      continue: "متابعة", back: "رجوع", checking: "جاري التحقق…", submitting: "جاري الإرسال…",
      fillBoth: "من فضلك اكتب رقم الأوردر ورقم التليفون.",
      network: "فيه مشكلة في الاتصال. حاول تاني.",
      notEligible: "الأوردر ده مش مؤهل للاسترجاع أو الاستبدال.",
      noItems: "مفيش قطع مؤهلة في الأوردر ده.",
      saleNote: "قطع الأوفر مش بتتسترجع ولا بتتبدل، ومش ظاهرة هنا.",
      testMode: "وضع تجريبي",
      whatToDo: "عايز تعمل إيه؟",
      refund: "استرجاع", refundSub: "استرد فلوسك",
      exchange: "استبدال", exchangeSub: "غيّر المقاس",
      pickItems: "اختار القطع", qty: "الكمية", include: "اختيار",
      newSize: "المقاس / النوع الجديد", loadingSizes: "جاري تحميل المقاسات…",
      outOfStock: "غير متوفر", noSizes: "مفيش مقاسات تانية متاحة.",
      pickOne: "اختار قطعة واحدة على الأقل.", pickSize: "اختار البديل لكل قطعة مختارة.",
      reason: "السبب",
      r_WRONG_SIZE: "المقاس غلط", r_DOESNT_FIT: "مش مناسب", r_CHANGED_MIND: "غيرت رأيي",
      r_NOT_AS_EXPECTED: "مش زي ما توقعت", r_OTHER: "سبب تاني",
      otherReason: "قولنا أكتر", needReason: "من فضلك اختار السبب.",
      payout: "نبعتلك الفلوس فين؟",
      eWallet: "محفظة إلكترونية (فودافون كاش وغيره)", instapay: "إنستاباي",
      mobile: "رقم المحفظة / إنستاباي",
      needPayout: "اختار طريقة الاسترداد واكتب رقم الموبايل.",
      optPayout: "محتاجينه بس لو البديل أرخص من الأصلي (الفرق بيترد ليك).",
      refundFeeNote: "بيتخصم رسوم استرجاع ثابتة من المبلغ حسب سياسة FITTEZ.",
      exchangeFeeNote: "بتضاف رسوم شحن الاستبدال حسب محافظتك. مندوب بوسطا هيستلم القطعة ويسلمك البديل.",
      review: "مراجعة", submit: "إرسال الطلب",
      done: "تم استلام طلبك", reqNo: "رقم الطلب", tracking: "رقم التتبع",
      status: "الحالة", doneRefund: "هنراجع طلب الاسترجاع ونتواصل معاك بخصوص الفلوس.",
      doneExchange: "تم حجز الاستبدال. احتفظ برقم التتبع.",
      another: "طلب جديد",
      item: "القطعة", type: "النوع", total: "القطع"
    }
  };

  var lang = "en";
  try { if (localStorage.getItem("fittez_lang") === "ar") lang = "ar"; } catch (e) {}

  var state = null;
  function reset() {
    state = {
      step: 1, orderNumber: "", phone: "", order: null, type: null,
      sel: {}, // idx -> {include, qty, variantId}
      sizes: {}, // productId -> array | "loading" | "none"
      reason: "", otherReason: "", method: "", mobile: "",
      key: uuid(), error: "", busy: false, result: null
    };
  }

  function t(k) { return (T[lang] && T[lang][k]) || T.en[k] || k; }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
        else if (k === "value") e.value = v;
        else if (k === "checked" || k === "disabled" || k === "selected") { if (v) e[k] = true; }
        else e.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      var err = new Error((data && data.error) || t("network"));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function stepsBar(n) {
    var s = h("div", { class: "steps" });
    for (var i = 1; i <= 4; i++) s.appendChild(h("span", { class: i <= n ? "on" : "" }));
    return s;
  }

  function errBox() { return state.error ? h("div", { class: "err", text: state.error }) : null; }

  /* ---------- Step 1: verify ---------- */
  function viewVerify() {
    var on = h("input", { type: "text", id: "orderNumber", placeholder: t("orderPh"), value: state.orderNumber, inputmode: "numeric", autocomplete: "off" });
    var ph = h("input", { type: "tel", id: "phone", placeholder: t("phonePh"), value: state.phone, autocomplete: "tel" });
    var btn = h("button", { type: "button", class: "btn", disabled: state.busy, text: state.busy ? t("checking") : t("continue"), onclick: async function () {
      state.orderNumber = on.value.trim();
      state.phone = ph.value.trim();
      if (!state.orderNumber || !state.phone) { state.error = t("fillBoth"); render(); return; }
      state.busy = true; state.error = ""; render();
      try {
        var data = await api("POST", "/api/orders/verify", { orderNumber: state.orderNumber, phone: state.phone });
        state.order = data;
        if (!data.eligible) { state.error = data.eligibilityReason || t("notEligible"); }
        else if (!data.items || !data.items.length) { state.error = t("noItems"); }
        else {
          state.sel = {};
          data.items.forEach(function (it, i) { state.sel[i] = { include: false, qty: 1, variantId: "" }; });
          state.step = 2;
        }
      } catch (e) { state.error = e.message; }
      state.busy = false; render();
    }});
    return h("div", { class: "card" }, [
      stepsBar(1),
      h("label", { for: "orderNumber", text: t("orderNo") }), on,
      h("label", { for: "phone", text: t("phone") }), ph,
      errBox(), btn
    ]);
  }

  /* ---------- Step 2: choose type ---------- */
  function viewType() {
    function pick(type) { state.type = type; state.error = ""; state.step = 3; render(); }
    return h("div", { class: "card" }, [
      stepsBar(2),
      state.order.testModeActive ? h("p", { class: "note" }, [t("testMode")]) : null,
      h("h2", { text: t("whatToDo") }),
      h("div", { class: "choices" }, [
        h("button", { type: "button", class: "choice", onclick: function () { pick("refund"); } }, [t("refund"), h("small", { text: t("refundSub") })]),
        h("button", { type: "button", class: "choice", onclick: function () { pick("exchange"); } }, [t("exchange"), h("small", { text: t("exchangeSub") })])
      ]),
      state.order.saleItemsExcluded ? h("p", { class: "note", text: t("saleNote") }) : null,
      h("button", { type: "button", class: "btn ghost", text: t("back"), onclick: function () { state.step = 1; render(); } })
    ]);
  }

  async function loadSizes(productId) {
    if (state.sizes[productId]) return;
    state.sizes[productId] = "loading";
    render();
    try {
      var data = await api("GET", "/api/exchanges/utils/replacement-availability?productId=" + encodeURIComponent(productId));
      var list = Array.isArray(data) ? data : (data && data.variants) || [];
      list = list.filter(function (v) { return !v.isSaleItem; });
      state.sizes[productId] = list.length ? list : "none";
    } catch (e) { state.sizes[productId] = "none"; }
    render();
  }

  /* ---------- Step 3: items + details ---------- */
  function viewDetails() {
    var items = state.order.items;
    var isEx = state.type === "exchange";
    var kids = [stepsBar(3), h("h2", { text: t("pickItems") })];

    items.forEach(function (it, i) {
      var s = state.sel[i];
      var title = it.productTitle + (it.variantTitle && it.variantTitle !== "Default Title" ? " — " + it.variantTitle : "");
      var cb = h("input", { type: "checkbox", id: "inc" + i, checked: s.include, onchange: function (ev) {
        s.include = ev.target.checked;
        if (s.include && isEx) loadSizes(it.productId);
        render();
      }});
      var row = h("div", { class: "row" }, [
        cb, h("label", { for: "inc" + i, text: t("include"), class: "" })
      ]);
      var box = h("div", { class: "item" }, [
        h("div", { class: "name", text: title }),
        h("div", { class: "meta", text: it.price + " EGP · x" + it.quantity }),
        row
      ]);
      if (s.include) {
        var q = h("input", { type: "number", min: "1", max: String(it.quantity), value: String(s.qty), onchange: function (ev) {
          var n = parseInt(ev.target.value, 10);
          if (!(n >= 1)) n = 1;
          if (n > it.quantity) n = it.quantity;
          s.qty = n; ev.target.value = String(n);
        }});
        box.appendChild(h("div", { class: "row" }, [h("span", { text: t("qty") }), q]));
        if (isEx) {
          var sz = state.sizes[it.productId];
          if (sz === "loading" || !sz) box.appendChild(h("p", { class: "note", text: t("loadingSizes") }));
          else if (sz === "none") box.appendChild(h("p", { class: "err", text: t("noSizes") }));
          else {
            var sel = h("select", { onchange: function (ev) { s.variantId = ev.target.value; } },
              [h("option", { value: "", text: "—" })].concat(sz.map(function (v) {
                return h("option", { value: v.variantId, disabled: !v.inStock, selected: s.variantId === v.variantId,
                  text: v.title + (v.inStock ? "" : " (" + t("outOfStock") + ")") });
              })));
            box.appendChild(h("label", { text: t("newSize") }));
            box.appendChild(sel);
          }
        }
      }
      kids.push(box);
    });

    if (!isEx) {
      var reasons = ["WRONG_SIZE", "DOESNT_FIT", "CHANGED_MIND", "NOT_AS_EXPECTED", "OTHER"];
      kids.push(h("label", { text: t("reason") }));
      kids.push(h("select", { onchange: function (ev) { state.reason = ev.target.value; render(); } },
        [h("option", { value: "", text: "—" })].concat(reasons.map(function (r) {
          return h("option", { value: r, selected: state.reason === r, text: t("r_" + r) });
        }))));
      if (state.reason === "OTHER") {
        kids.push(h("label", { text: t("otherReason") }));
        kids.push(h("textarea", { rows: "3", maxlength: "500", oninput: function (ev) { state.otherReason = ev.target.value; } }, [state.otherReason]));
      }
    } else {
      kids.push(h("p", { class: "note", text: t("optPayout") }));
    }

    kids.push(h("label", { text: t("payout") }));
    kids.push(h("select", { onchange: function (ev) { state.method = ev.target.value; } }, [
      h("option", { value: "", text: "—" }),
      h("option", { value: "E_WALLET", selected: state.method === "E_WALLET", text: t("eWallet") }),
      h("option", { value: "INSTAPAY", selected: state.method === "INSTAPAY", text: t("instapay") })
    ]));
    kids.push(h("label", { text: t("mobile") }));
    kids.push(h("input", { type: "tel", value: state.mobile, placeholder: t("phonePh"), oninput: function (ev) { state.mobile = ev.target.value; } }));

    kids.push(h("p", { class: "note", text: isEx ? t("exchangeFeeNote") : t("refundFeeNote") }));
    kids.push(errBox());
    kids.push(h("div", {}, [
      h("button", { type: "button", class: "btn", text: t("review"), onclick: function () {
        var chosen = selected();
        if (!chosen.length) { state.error = t("pickOne"); render(); return; }
        if (isEx) {
          for (var i = 0; i < chosen.length; i++) if (!chosen[i].s.variantId) { state.error = t("pickSize"); render(); return; }
        } else {
          if (!state.reason) { state.error = t("needReason"); render(); return; }
          if (!state.method || state.mobile.trim().length < 6) { state.error = t("needPayout"); render(); return; }
        }
        state.error = ""; state.step = 4; render();
      }}),
      h("button", { type: "button", class: "btn ghost", text: t("back"), onclick: function () { state.error = ""; state.step = 2; render(); } })
    ]));
    return h("div", { class: "card" }, kids);
  }

  function selected() {
    var out = [];
    state.order.items.forEach(function (it, i) {
      var s = state.sel[i];
      if (s && s.include) out.push({ it: it, s: s });
    });
    return out;
  }

  /* ---------- Step 4: review + submit ---------- */
  function viewReview() {
    var isEx = state.type === "exchange";
    var chosen = selected();
    var dl = h("dl", { class: "summary" }, [
      h("dt", { text: t("type") }), h("dd", { text: isEx ? t("exchange") : t("refund") }),
      h("dt", { text: t("orderNo") }), h("dd", { text: state.order.orderName || state.orderNumber }),
      h("dt", { text: t("total") })
    ]);
    chosen.forEach(function (c) {
      var line = c.it.productTitle + (c.it.variantTitle && c.it.variantTitle !== "Default Title" ? " — " + c.it.variantTitle : "") + "  x" + c.s.qty;
      var dd = h("dd", { text: line });
      if (isEx) {
        var list = state.sizes[c.it.productId];
        var v = Array.isArray(list) ? list.filter(function (x) { return x.variantId === c.s.variantId; })[0] : null;
        if (v) dd.appendChild(h("span", { class: "badge", text: "→ " + v.title }));
      }
      dl.appendChild(dd);
    });
    if (!isEx) {
      dl.appendChild(h("dt", { text: t("reason") }));
      dl.appendChild(h("dd", { text: t("r_" + state.reason) }));
    }
    if (state.method) {
      dl.appendChild(h("dt", { text: t("payout") }));
      dl.appendChild(h("dd", { text: (state.method === "E_WALLET" ? t("eWallet") : t("instapay")) + " · " + state.mobile }));
    }

    var btn = h("button", { type: "button", class: "btn", disabled: state.busy, text: state.busy ? t("submitting") : t("submit"), onclick: submit });
    return h("div", { class: "card" }, [
      stepsBar(4), h("h2", { text: t("review") }), dl,
      h("p", { class: "note", text: isEx ? t("exchangeFeeNote") : t("refundFeeNote") }),
      errBox(),
      h("div", {}, [btn, h("button", { type: "button", class: "btn ghost", disabled: state.busy, text: t("back"), onclick: function () { state.error = ""; state.step = 3; render(); } })])
    ]);
  }

  async function submit() {
    var isEx = state.type === "exchange";
    var chosen = selected();
    state.busy = true; state.error = ""; render();
    try {
      var result;
      if (isEx) {
        result = await api("POST", "/api/exchanges/create", {
          orderNumber: state.orderNumber, phone: state.phone, idempotencyKey: state.key,
          items: chosen.map(function (c) {
            return {
              originalLineItemId: c.it.lineItemId, originalQuantity: c.s.qty,
              replacementProductId: c.it.productId, replacementVariantId: c.s.variantId, replacementQuantity: c.s.qty
            };
          }),
          refundMethod: state.method || undefined,
          refundMobile: state.mobile.trim() || undefined
        });
      } else {
        var body = {
          orderNumber: state.orderNumber, phone: state.phone, idempotencyKey: state.key,
          reason: state.reason, refundMethod: state.method, refundMobile: state.mobile.trim(),
          items: chosen.map(function (c) { return { lineItemId: c.it.lineItemId, quantity: c.s.qty }; })
        };
        if (state.reason === "OTHER" && state.otherReason.trim()) body.otherReason = state.otherReason.trim();
        result = await api("POST", "/api/refunds/create", body);
      }
      state.result = result;
      state.step = 5;
    } catch (e) { state.error = e.message; }
    state.busy = false; render();
  }

  /* ---------- Step 5: done ---------- */
  function viewDone() {
    var r = state.result || {};
    var isEx = state.type === "exchange";
    var dl = h("dl", { class: "summary" }, []);
    if (r.id) { dl.appendChild(h("dt", { text: t("reqNo") })); dl.appendChild(h("dd", { text: String(r.id) })); }
    if (r.bostaTrackingNumber) { dl.appendChild(h("dt", { text: t("tracking") })); dl.appendChild(h("dd", { class: "big", text: String(r.bostaTrackingNumber) })); }
    if (r.status) { dl.appendChild(h("dt", { text: t("status") })); dl.appendChild(h("dd", { text: String(r.status) })); }
    return h("div", { class: "card" }, [
      h("h2", { class: "ok", text: t("done") }),
      h("p", { text: isEx ? t("doneExchange") : t("doneRefund") }),
      dl,
      h("button", { type: "button", class: "btn", text: t("another"), onclick: function () { reset(); render(); } })
    ]);
  }

  function render() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.getElementById("title").textContent = t("title");
    document.getElementById("subtitle").textContent = t("subtitle");
    document.getElementById("langBtn").textContent = lang === "ar" ? "English" : "العربية";
    var app = document.getElementById("app");
    app.textContent = "";
    var views = { 1: viewVerify, 2: viewType, 3: viewDetails, 4: viewReview, 5: viewDone };
    app.appendChild(views[state.step]());
  }

  document.getElementById("langBtn").addEventListener("click", function () {
    lang = lang === "ar" ? "en" : "ar";
    try { localStorage.setItem("fittez_lang", lang); } catch (e) {}
    render();
  });

  reset();
  render();
})();
