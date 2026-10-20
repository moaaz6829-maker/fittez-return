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
      pickItems: "Choose the items you want to return.", qty: "Quantity", include: "Include",
      exchangeTitle: "Exchange", refundTitle: "Return",
      exchangeHelp: "Tick the item you want to swap, then choose the new size or a different product. The courier picks up the old one and delivers the new one.",
      replaceWith: "Replace with", chooseOther: "Choose a different product", closePicker: "Close",
      sameProduct: "Back to the same product", searchPh: "Search products…",
      loadingProducts: "Loading products…", noProducts: "No available products found.",
      diffPayout: "The new item is cheaper — where should we send your credit?",
      quoteHint: "Pick the new size to see the price.", quoteCalc: "Calculating the price…",
      quoteWait: "Please wait for the price to load.",
      qReturned: "Items you return", qNew: "New items", qDiff: "Price difference", qFee: "Exchange delivery fee",
      qCod: "You pay on delivery:", qCredit: "We refund you:",
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
      doneExchange: "We received your exchange request. Our team will review it and email you as soon as it is approved, with your tracking link.",
      another: "Start another request",
      alreadyTitle: "We're already working on your request",
      alreadyText: "There is already an open request for this order, so you can't submit another one. You can follow its progress below.",
      trackBtn: "Track request", trackTitle: "Request progress", openBosta: "Track shipment",
      typeRefund: "Return", typeExchange: "Exchange",
      stRefund1: "Under review", stRefund2: "Approved", stRefund3: "Refund sent",
      stExchange1: "Under review", stExchange2: "Approved – shipment booked", stExchange3: "Out for delivery",
      current: "Current step",
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
      pickItems: "اختار القطع اللي عايز ترجعها.", qty: "الكمية", include: "اختيار",
      exchangeTitle: "استبدال", refundTitle: "استرجاع",
      exchangeHelp: "علّم على القطعة اللي عايز تبدلها، واختار المقاس الجديد أو منتج مختلف. المندوب هيستلم القديمة ويسلمك الجديدة.",
      replaceWith: "استبدلها بـ", chooseOther: "اختار منتج تاني", closePicker: "إغلاق",
      sameProduct: "رجوع لنفس المنتج", searchPh: "دوّر على منتج…",
      loadingProducts: "جاري تحميل المنتجات…", noProducts: "مفيش منتجات متاحة.",
      diffPayout: "المنتج الجديد أرخص — نبعتلك الفرق فين؟",
      quoteHint: "اختار المقاس الجديد عشان يظهر السعر.", quoteCalc: "جاري حساب السعر…",
      quoteWait: "استنى لحد ما السعر يظهر.",
      qReturned: "القطع اللي هترجعها", qNew: "القطع الجديدة", qDiff: "فرق السعر", qFee: "رسوم شحن الاستبدال",
      qCod: "هتدفع عند الاستلام:", qCredit: "هنرجعلك:",
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
      doneExchange: "استلمنا طلب الاستبدال. فريقنا هيراجعه وهنبعتلك إيميل أول ما تتم الموافقة، ومعاه لينك التتبع.",
      another: "طلب جديد",
      alreadyTitle: "إحنا شغالين بالفعل على طلبك",
      alreadyText: "فيه طلب مفتوح على الأوردر ده، فمينفعش تقدّم طلب تاني. تقدر تتابع حالته من تحت.",
      trackBtn: "متابعة الطلب", trackTitle: "حالة الطلب", openBosta: "تتبّع الشحنة",
      typeRefund: "استرجاع", typeExchange: "استبدال",
      stRefund1: "قيد المراجعة", stRefund2: "تمت الموافقة", stRefund3: "تم إرسال الفلوس",
      stExchange1: "قيد المراجعة", stExchange2: "تمت الموافقة – تم حجز الشحنة", stExchange3: "الأوردر في الطريق",
      current: "الخطوة الحالية",
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
      quote: null, quoteKey: "", quoteErr: "", quoteLoading: false,
      key: uuid(), error: "", busy: false, result: null, existing: null
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
          var mine = null;
          try { mine = await api("POST", "/api/catalog/my-request", { orderNumber: state.orderNumber, phone: state.phone }); } catch (e2) { mine = null; }
          if (mine && mine.open) { state.existing = mine; state.step = 6; state.busy = false; render(); return; }
          state.sel = {};
          data.items.forEach(function (it, i) {
            state.sel[i] = { include: false, qty: 1, variantId: "", replProductId: it.productId, replTitle: "", q: "", picking: false };
          });
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

  /* ---------- Product picker (exchange for a different product) ---------- */
  var catalogCache = {};
  async function fetchCatalog(term) {
    var key = term.trim().toLowerCase();
    if (catalogCache[key]) return catalogCache[key];
    var list = await api("GET", "/api/catalog/search?q=" + encodeURIComponent(term.trim()));
    catalogCache[key] = Array.isArray(list) ? list : [];
    return catalogCache[key];
  }

  function buildPicker(s, it, originalTitle) {
    var results = h("div", { class: "pgrid" });
    var timer = null;
    var seq = 0;

    function draw(list) {
      results.textContent = "";
      if (!list.length) { results.appendChild(h("p", { class: "note", text: t("noProducts") })); return; }
      list.forEach(function (p) {
        var card = h("button", { type: "button", class: "pcard", onclick: function () {
          s.replProductId = p.productId;
          s.replTitle = p.title;
          s.variantId = "";
          s.picking = false;
          loadSizes(p.productId);
          render();
        }}, [
          p.imageUrl ? h("img", { src: p.imageUrl, alt: p.title, loading: "lazy" }) : h("div", { class: "pimg" }),
          h("div", { class: "pname", text: p.title }),
          h("div", { class: "pprice", text: p.price + " EGP" })
        ]);
        results.appendChild(card);
      });
    }

    async function load() {
      var my = ++seq;
      results.textContent = "";
      results.appendChild(h("p", { class: "note", text: t("loadingProducts") }));
      try {
        var list = await fetchCatalog(s.q || "");
        if (my === seq) draw(list);
      } catch (e) {
        if (my === seq) { results.textContent = ""; results.appendChild(h("p", { class: "err", text: e.message })); }
      }
    }

    var input = h("input", { type: "text", placeholder: t("searchPh"), value: s.q || "", oninput: function (ev) {
      s.q = ev.target.value;
      clearTimeout(timer);
      timer = setTimeout(load, 350);
    }});

    var wrap = h("div", { class: "picker" }, [input]);
    if (s.replProductId !== it.productId) {
      wrap.appendChild(h("button", { type: "button", class: "btn ghost small", text: t("sameProduct") + ": " + originalTitle, onclick: function () {
        s.replProductId = it.productId; s.replTitle = ""; s.variantId = ""; s.picking = false;
        loadSizes(it.productId);
        render();
      }}));
    }
    wrap.appendChild(results);
    load();
    return wrap;
  }

  /* ---------- Step 3: items + details ---------- */
  function viewDetails() {
    var items = state.order.items;
    var isEx = state.type === "exchange";
    var kids = [
      stepsBar(3),
      h("h2", { text: isEx ? t("exchangeTitle") : t("refundTitle") }),
      h("p", { class: "note", text: isEx ? t("exchangeHelp") : t("pickItems") })
    ];

    items.forEach(function (it, i) {
      var s = state.sel[i];
      var title = it.productTitle + (it.variantTitle && it.variantTitle !== "Default Title" ? " — " + it.variantTitle : "");
      var cb = h("input", { type: "checkbox", id: "inc" + i, checked: s.include, onchange: function (ev) {
        s.include = ev.target.checked;
        if (s.include && isEx) loadSizes(s.replProductId || it.productId);
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
          if (isEx) render();
        }});
        box.appendChild(h("div", { class: "row" }, [h("span", { text: t("qty") }), q]));
        if (isEx) {
          var rp = s.replProductId || it.productId;
          var isSame = rp === it.productId;
          box.appendChild(h("label", { text: t("replaceWith") }));
          box.appendChild(h("div", { class: "selprod" }, [
            h("span", { text: isSame ? title : (s.replTitle || "") }),
            h("button", { type: "button", class: "btn ghost small", text: s.picking ? t("closePicker") : t("chooseOther"), onclick: function () {
              s.picking = !s.picking; render();
            }})
          ]));
          if (s.picking) {
            box.appendChild(buildPicker(s, it, title));
          }
          var sz = state.sizes[rp];
          if (sz === "loading" || !sz) box.appendChild(h("p", { class: "note", text: t("loadingSizes") }));
          else if (sz === "none") box.appendChild(h("p", { class: "err", text: t("noSizes") }));
          else {
            var sel = h("select", { onchange: function (ev) { s.variantId = ev.target.value; render(); } },
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
    }

    // Exchange: live price summary computed by the server. The payout fields
    // below only appear (and are only required) when the new product is
    // cheaper by more than the exchange fee, i.e. FITTEZ owes the customer money.
    if (isEx) {
      refreshQuote(selected());
      kids.push(quoteBox());
    }

    if (!isEx || needsCredit()) {
      kids.push(h("label", { text: isEx ? t("diffPayout") : t("payout") }));
      kids.push(h("select", { onchange: function (ev) { state.method = ev.target.value; } }, [
        h("option", { value: "", text: "—" }),
        h("option", { value: "E_WALLET", selected: state.method === "E_WALLET", text: t("eWallet") }),
        h("option", { value: "INSTAPAY", selected: state.method === "INSTAPAY", text: t("instapay") })
      ]));
      kids.push(h("label", { text: t("mobile") }));
      kids.push(h("input", { type: "tel", value: state.mobile, placeholder: t("phonePh"), oninput: function (ev) { state.mobile = ev.target.value; } }));
    }

    kids.push(h("p", { class: "note", text: isEx ? t("exchangeFeeNote") : t("refundFeeNote") }));
    kids.push(errBox());
    kids.push(h("div", {}, [
      h("button", { type: "button", class: "btn", text: t("review"), onclick: function () {
        var chosen = selected();
        if (!chosen.length) { state.error = t("pickOne"); render(); return; }
        if (isEx) {
          for (var i = 0; i < chosen.length; i++) if (!chosen[i].s.variantId) { state.error = t("pickSize"); render(); return; }
          if (state.quoteErr || !state.quote) { state.error = state.quoteErr || t("quoteWait"); render(); return; }
          if (needsCredit() && (!state.method || state.mobile.trim().length < 6)) { state.error = t("needPayout"); render(); return; }
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

  /* ---------- Exchange price quote (server-calculated) ---------- */
  function needsCredit() {
    return !!(state.quote && Number(state.quote.customerCredit) > 0);
  }

  function refreshQuote(chosen) {
    var items = [];
    for (var i = 0; i < chosen.length; i++) {
      var c = chosen[i];
      if (!c.s.variantId) { items = null; break; }
      items.push({
        originalLineItemId: c.it.lineItemId, originalQuantity: c.s.qty,
        replacementVariantId: c.s.variantId, replacementQuantity: c.s.qty
      });
    }
    if (!items || !items.length) {
      state.quote = null; state.quoteKey = ""; state.quoteErr = ""; state.quoteLoading = false;
      return;
    }
    var key = JSON.stringify(items);
    if (key === state.quoteKey) return;
    state.quoteKey = key; state.quote = null; state.quoteErr = ""; state.quoteLoading = true;
    api("POST", "/api/catalog/exchange-quote", { orderNumber: state.orderNumber, phone: state.phone, items: items })
      .then(function (q) { if (state.quoteKey === key) { state.quote = q; state.quoteLoading = false; render(); } })
      .catch(function (e) { if (state.quoteKey === key) { state.quoteErr = e.message; state.quoteLoading = false; render(); } });
  }

  function egp(n) { return Number(n).toFixed(2).replace(/\.00$/, "") + " EGP"; }

  function quoteBox() {
    if (state.quoteErr) return h("p", { class: "err", text: state.quoteErr });
    if (state.quoteLoading) return h("p", { class: "note", text: t("quoteCalc") });
    if (!state.quote) return h("p", { class: "note", text: t("quoteHint") });
    var q = state.quote;
    var diff = Number(q.priceDifference);
    var rows = [
      h("dt", { text: t("qReturned") }), h("dd", { text: egp(q.returnedTotal) }),
      h("dt", { text: t("qNew") }), h("dd", { text: egp(q.replacementTotal) }),
      h("dt", { text: t("qDiff") }), h("dd", { text: (diff > 0 ? "+" : "") + egp(diff) }),
      h("dt", { text: t("qFee") }), h("dd", { text: egp(q.exchangeFee) })
    ];
    var credit = Number(q.customerCredit);
    var result = credit > 0
      ? h("p", { class: "ok", text: t("qCredit") + " " + egp(credit) })
      : h("p", { class: "big", text: t("qCod") + " " + egp(q.cod) });
    return h("div", { class: "quote" }, [h("dl", { class: "summary" }, rows), result]);
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
        var list = state.sizes[c.s.replProductId || c.it.productId];
        var v = Array.isArray(list) ? list.filter(function (x) { return x.variantId === c.s.variantId; })[0] : null;
        var newName = c.s.replProductId && c.s.replProductId !== c.it.productId ? c.s.replTitle : "";
        if (v || newName) dd.appendChild(h("span", { class: "badge", text: "→ " + (newName ? newName + (v ? " — " : "") : "") + (v ? v.title : "") }));
      }
      dl.appendChild(dd);
    });
    if (!isEx) {
      dl.appendChild(h("dt", { text: t("reason") }));
      dl.appendChild(h("dd", { text: t("r_" + state.reason) }));
    }
    if (state.method && (!isEx || needsCredit())) {
      dl.appendChild(h("dt", { text: t("payout") }));
      dl.appendChild(h("dd", { text: (state.method === "E_WALLET" ? t("eWallet") : t("instapay")) + " · " + state.mobile }));
    }

    var btn = h("button", { type: "button", class: "btn", disabled: state.busy, text: state.busy ? t("submitting") : t("submit"), onclick: submit });
    return h("div", { class: "card" }, [
      stepsBar(4), h("h2", { text: t("review") }), dl, isEx ? quoteBox() : null,
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
              replacementProductId: c.s.replProductId || c.it.productId, replacementVariantId: c.s.variantId, replacementQuantity: c.s.qty
            };
          }),
          refundMethod: needsCredit() ? state.method || undefined : undefined,
          refundMobile: needsCredit() ? state.mobile.trim() || undefined : undefined
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


  /* ---------- Already has an open request ---------- */
  function viewExisting() {
    var e = state.existing || {};
    return h("div", { class: "card" }, [
      h("h2", { text: t("alreadyTitle") }),
      h("p", { text: t("alreadyText") }),
      h("button", { type: "button", class: "btn", text: t("trackBtn"), onclick: function () { state.step = 7; render(); } }),
      h("button", { type: "button", class: "btn ghost", text: t("back"), onclick: function () { reset(); render(); } })
    ]);
  }

  function viewTrack() {
    var e = state.existing || {};
    var kind = e.type === "refund" ? "Refund" : "Exchange";
    var list = h("div", { class: "track" }, []);
    for (var i = 1; i <= 3; i++) {
      var done = i <= (e.stage || 1);
      list.appendChild(h("div", { class: "track-row" + (done ? " done" : "") + (i === e.stage ? " now" : "") }, [
        h("span", { class: "dot", text: done ? "●" : "○" }),
        h("span", { text: " " + t("st" + kind + i) })
      ]));
    }
    var dl = h("dl", { class: "summary" }, []);
    dl.appendChild(h("dt", { text: t("type") })); dl.appendChild(h("dd", { text: e.type === "refund" ? t("typeRefund") : t("typeExchange") }));
    if (e.id) { dl.appendChild(h("dt", { text: t("reqNo") })); dl.appendChild(h("dd", { text: String(e.id) })); }
    if (e.tracking) { dl.appendChild(h("dt", { text: t("tracking") })); dl.appendChild(h("dd", { class: "big", text: String(e.tracking) })); }
    var kids = [
      h("h2", { text: t("trackTitle") }),
      list,
      dl
    ];
    if (e.trackingUrl) {
      kids.push(h("a", { class: "btn", href: e.trackingUrl, target: "_blank", rel: "noopener", text: t("openBosta") }));
    }
    kids.push(h("button", { type: "button", class: "btn ghost", text: t("back"), onclick: function () { state.step = 6; render(); } }));
    return h("div", { class: "card" }, kids);
  }

  function render() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.getElementById("title").textContent = t("title");
    document.getElementById("subtitle").textContent = t("subtitle");
    document.getElementById("langBtn").textContent = lang === "ar" ? "English" : "العربية";
    var app = document.getElementById("app");
    app.textContent = "";
    var views = { 1: viewVerify, 2: viewType, 3: viewDetails, 4: viewReview, 5: viewDone, 6: viewExisting, 7: viewTrack };
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
