(() => {
  "use strict";

  const STORAGE_KEY = "merca-facil-state-v1";
  const seed = window.MERCA_SEED;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const restaurantColors = { horno: "#f3b45b", parador: "#6796dd", patio: "#9bc58c", all: "#f3b45b" };

  const ui = {
    restaurant: "horno",
    view: "pending",
    search: "",
    category: "all",
  };

  let state = loadState();
  let undoSnapshot = null;
  let installPrompt = null;
  let toastTimer = null;
  let recognition = null;

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const elements = {
    saveStatus: $("#save-status"),
    pendingCount: $("#pending-count"),
    orderedCount: $("#ordered-count"),
    orderedLabel: $("#ordered-label"),
    progress: $(".progress"),
    progressBar: $("#progress-bar"),
    restaurantTabs: $("#restaurant-tabs"),
    viewTabs: $("#view-tabs"),
    search: $("#search-input"),
    clearSearch: $("#clear-search"),
    category: $("#category-filter"),
    list: $("#product-list"),
    assistantDialog: $("#assistant-dialog"),
    assistantButton: $("#assistant-button"),
    assistantForm: $("#assistant-form"),
    assistantInput: $("#assistant-input"),
    assistantHistory: $("#assistant-history"),
    micButton: $("#mic-button"),
    undoButton: $("#undo-button"),
    addDialog: $("#add-dialog"),
    addButton: $("#add-button"),
    addForm: $("#add-form"),
    addProduct: $("#add-product"),
    addQuantity: $("#add-quantity"),
    addRestaurant: $("#add-restaurant"),
    addCategory: $("#add-category"),
    suggestions: $("#product-suggestions"),
    manageDialog: $("#manage-dialog"),
    manageButton: $("#manage-button"),
    installButton: $("#install-button"),
    toast: $("#toast"),
  };

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && Array.isArray(stored.items) && Array.isArray(stored.restaurants)) return stored;
    } catch (error) {
      console.warn("No se pudo leer el estado guardado", error);
    }
    return clone(seed);
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function makeId(name, category) {
    const base = `${normalize(category)}-${normalize(name)}`.replaceAll(" ", "-").slice(0, 58) || "producto";
    let id = base;
    let suffix = 2;
    while (state.items.some((item) => item.id === id)) id = `${base}-${suffix++}`;
    return id;
  }

  function save(message = "Guardado") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    elements.saveStatus.textContent = message;
    window.clearTimeout(save.statusTimer);
    save.statusTimer = window.setTimeout(() => {
      elements.saveStatus.textContent = "Guardado en este dispositivo";
    }, 1500);
  }

  function prepareMutation() {
    undoSnapshot = clone(state);
    elements.undoButton.hidden = false;
  }

  function commit(message) {
    save();
    render();
    if (message) showToast(message);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2300);
  }

  function getRestaurant(id) {
    return state.restaurants.find((restaurant) => restaurant.id === id);
  }

  function hasQuantity(item, restaurantId) {
    return String(item.amounts?.[restaurantId] ?? "").trim() !== "";
  }

  function renderSummary() {
    let pending = 0;
    let ordered = 0;
    for (const item of state.items) {
      for (const restaurant of state.restaurants) {
        if (!hasQuantity(item, restaurant.id)) continue;
        if (item.ordered?.[restaurant.id]) ordered += 1;
        else pending += 1;
      }
    }
    const total = pending + ordered;
    const percent = total ? Math.round((ordered / total) * 100) : 0;
    elements.pendingCount.textContent = String(pending);
    elements.orderedCount.textContent = String(ordered);
    elements.orderedLabel.textContent = ordered === 1 ? "pedido" : "pedidos";
    elements.progressBar.style.width = `${percent}%`;
    elements.progress.setAttribute("aria-valuenow", String(percent));
  }

  function renderRestaurantTabs() {
    const tabs = [...state.restaurants, { id: "all", name: "Todo" }];
    elements.restaurantTabs.innerHTML = tabs.map((restaurant) => `
      <button
        class="restaurant-tab"
        type="button"
        data-restaurant="${restaurant.id}"
        aria-pressed="${ui.restaurant === restaurant.id}"
        style="--tab-color:${restaurantColors[restaurant.id]}"
      >${escapeHtml(restaurant.name)}</button>
    `).join("");
  }

  function renderCategoryOptions() {
    const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))];
    const selected = categories.includes(ui.category) ? ui.category : "all";
    ui.category = selected;
    elements.category.innerHTML = `<option value="all">Todas las categorías</option>${categories.map((category) => `
      <option value="${escapeHtml(category)}" ${selected === category ? "selected" : ""}>${escapeHtml(category)}</option>
    `).join("")}`;
  }

  function matchesFilters(item) {
    if (ui.category !== "all" && item.category !== ui.category) return false;
    if (!ui.search) return true;
    const haystack = normalize(`${item.name} ${item.category} ${item.source}`);
    return haystack.includes(normalize(ui.search));
  }

  function getVisibleEntries() {
    const entries = [];
    for (const item of state.items) {
      if (!matchesFilters(item)) continue;
      if (ui.restaurant === "all" && ui.view === "catalog") {
        entries.push({ item, restaurantId: null });
        continue;
      }
      const restaurantIds = ui.restaurant === "all"
        ? state.restaurants.map((restaurant) => restaurant.id)
        : [ui.restaurant];
      for (const restaurantId of restaurantIds) {
        const active = hasQuantity(item, restaurantId);
        const ordered = Boolean(item.ordered?.[restaurantId]);
        if (ui.view === "pending" && (!active || ordered)) continue;
        if (ui.view === "ordered" && (!active || !ordered)) continue;
        entries.push({ item, restaurantId });
      }
    }
    return entries;
  }

  function renderProductRow(entry) {
    const { item, restaurantId } = entry;
    if (!restaurantId) {
      const count = state.restaurants.filter((restaurant) => hasQuantity(item, restaurant.id)).length;
      return `
        <article class="product-row" data-item-id="${item.id}">
          <div class="check-button" aria-hidden="true">+</div>
          <div class="product-info">
            <p class="product-name">${escapeHtml(item.name)}</p>
            <div class="product-meta"><span>${escapeHtml(item.category)}</span>${count ? `<span>· En ${count} ${count === 1 ? "restaurante" : "restaurantes"}</span>` : ""}</div>
          </div>
          <button class="catalog-add" type="button" data-action="open-add" data-item-id="${item.id}">Añadir</button>
        </article>`;
    }

    const restaurant = getRestaurant(restaurantId);
    const amount = item.amounts?.[restaurantId] ?? "";
    const active = hasQuantity(item, restaurantId);
    const ordered = Boolean(item.ordered?.[restaurantId]);
    return `
      <article class="product-row ${ordered ? "is-ordered" : ""}" data-item-id="${item.id}" data-restaurant-id="${restaurantId}">
        <button class="check-button ${ordered ? "is-checked" : ""}" type="button" data-action="toggle" aria-label="${ordered ? "Volver a pendiente" : "Marcar como pedido"}" ${active ? "" : "disabled"}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg>
        </button>
        <div class="product-info">
          <p class="product-name">${escapeHtml(item.name)}</p>
          <div class="product-meta"><span class="restaurant-dot" style="--dot-color:${restaurantColors[restaurantId]}"></span><span>${escapeHtml(restaurant.name)}</span><span>· ${escapeHtml(item.category)}</span></div>
        </div>
        <div class="quantity-tools">
          <button class="quantity-button" type="button" data-action="decrement" aria-label="Restar uno">−</button>
          <input class="quantity-input" data-action="quantity" value="${escapeHtml(amount)}" aria-label="Cantidad de ${escapeHtml(item.name)} para ${escapeHtml(restaurant.name)}" inputmode="text">
          <button class="quantity-button" type="button" data-action="increment" aria-label="Sumar uno">+</button>
          <button class="remove-button" type="button" data-action="remove" aria-label="Quitar de la lista">×</button>
        </div>
      </article>`;
  }

  function renderList() {
    const entries = getVisibleEntries();
    if (!entries.length) {
      const searched = Boolean(ui.search || ui.category !== "all");
      elements.list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M7 3v4m10-4v4M6 11h12v9H6z"/><path d="m9 15 2 2 4-4"/></svg></div>
          <h3>${searched ? "No encuentro ese producto" : ui.view === "pending" ? "Todo pedido por aquí" : "Todavía no hay productos"}</h3>
          <p>${searched ? "Prueba con otro nombre o mira el catálogo." : ui.view === "pending" ? "Puedes añadir algo nuevo o consultar el catálogo." : "Añade el primer producto cuando lo necesites."}</p>
          <button type="button" data-empty-action="${searched ? "clear" : "catalog"}">${searched ? "Quitar filtros" : "Ver catálogo"}</button>
        </div>`;
      return;
    }

    let lastCategory = "";
    elements.list.innerHTML = entries.map((entry) => {
      const heading = entry.item.category !== lastCategory
        ? `<h2 class="category-heading">${escapeHtml(entry.item.category)}</h2>`
        : "";
      lastCategory = entry.item.category;
      return heading + renderProductRow(entry);
    }).join("");
  }

  function render() {
    renderSummary();
    renderRestaurantTabs();
    renderCategoryOptions();
    $$("button", elements.viewTabs).forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === ui.view)));
    elements.search.value = ui.search;
    elements.clearSearch.hidden = !ui.search;
    renderList();
    populateSuggestions();
  }

  function getLineFromTarget(target) {
    const row = target.closest(".product-row");
    if (!row) return null;
    return {
      row,
      item: state.items.find((candidate) => candidate.id === row.dataset.itemId),
      restaurantId: row.dataset.restaurantId,
    };
  }

  function adjustQuantity(value, delta) {
    const text = String(value ?? "").trim();
    if (!text) return delta > 0 ? "1" : "";
    const match = text.match(/^([0-9]+(?:[.,][0-9]+)?)(.*)$/);
    if (!match) return delta > 0 ? text : "";
    const number = Number(match[1].replace(",", "."));
    const next = Math.max(0, number + delta);
    if (!next) return "";
    const formatted = Number.isInteger(next) ? String(next) : String(next).replace(".", ",");
    return `${formatted}${match[2]}`;
  }

  function updateAmount(item, restaurantId, amount) {
    if (!item || !restaurantId) return;
    item.amounts[restaurantId] = String(amount ?? "").trim();
    if (!hasQuantity(item, restaurantId)) item.ordered[restaurantId] = false;
  }

  elements.restaurantTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-restaurant]");
    if (!button) return;
    ui.restaurant = button.dataset.restaurant;
    render();
  });

  elements.viewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    ui.view = button.dataset.view;
    render();
  });

  elements.search.addEventListener("input", () => {
    ui.search = elements.search.value;
    renderList();
    elements.clearSearch.hidden = !ui.search;
  });

  elements.clearSearch.addEventListener("click", () => {
    ui.search = "";
    elements.search.value = "";
    elements.clearSearch.hidden = true;
    renderList();
    elements.search.focus();
  });

  elements.category.addEventListener("change", () => {
    ui.category = elements.category.value;
    renderList();
  });

  elements.list.addEventListener("click", (event) => {
    const emptyButton = event.target.closest("[data-empty-action]");
    if (emptyButton) {
      if (emptyButton.dataset.emptyAction === "clear") {
        ui.search = "";
        ui.category = "all";
      } else {
        ui.view = "catalog";
      }
      render();
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton || actionButton.dataset.action === "quantity") return;
    const line = getLineFromTarget(actionButton);
    if (!line?.item && actionButton.dataset.action !== "open-add") return;
    if (actionButton.dataset.action === "open-add") {
      openAddDialog(actionButton.dataset.itemId);
      return;
    }

    prepareMutation();
    const amount = line.item.amounts[line.restaurantId];
    if (actionButton.dataset.action === "toggle") {
      line.item.ordered[line.restaurantId] = !line.item.ordered[line.restaurantId];
      commit(line.item.ordered[line.restaurantId] ? "Marcado como pedido" : "Vuelve a estar pendiente");
    } else if (actionButton.dataset.action === "increment") {
      updateAmount(line.item, line.restaurantId, adjustQuantity(amount, 1));
      commit();
    } else if (actionButton.dataset.action === "decrement") {
      updateAmount(line.item, line.restaurantId, adjustQuantity(amount, -1));
      commit();
    } else if (actionButton.dataset.action === "remove") {
      updateAmount(line.item, line.restaurantId, "");
      commit("Quitado de la lista");
    }
  });

  elements.list.addEventListener("change", (event) => {
    const input = event.target.closest('[data-action="quantity"]');
    if (!input) return;
    const line = getLineFromTarget(input);
    if (!line?.item) return;
    prepareMutation();
    updateAmount(line.item, line.restaurantId, input.value);
    commit("Cantidad actualizada");
  });

  function populateSuggestions() {
    elements.suggestions.innerHTML = state.items.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  }

  function populateAddForm() {
    elements.addRestaurant.innerHTML = state.restaurants.map((restaurant) => `<option value="${restaurant.id}">${escapeHtml(restaurant.name)}</option>`).join("");
    elements.addCategory.innerHTML = [...new Set(state.items.map((item) => item.category))].map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  }

  function openAddDialog(itemId = null) {
    const item = state.items.find((candidate) => candidate.id === itemId);
    const restaurantId = ui.restaurant === "all" ? "horno" : ui.restaurant;
    elements.addProduct.value = item?.name ?? "";
    elements.addRestaurant.value = restaurantId;
    elements.addCategory.value = item?.category ?? elements.addCategory.options[0]?.value ?? "Polivalencia";
    elements.addQuantity.value = item?.amounts?.[restaurantId] || "1";
    elements.addDialog.showModal();
    window.setTimeout(() => elements.addProduct.focus(), 50);
  }

  elements.addButton.addEventListener("click", () => openAddDialog());

  elements.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.addProduct.value.trim();
    const amount = elements.addQuantity.value.trim();
    const restaurantId = elements.addRestaurant.value;
    const category = elements.addCategory.value;
    if (!name || !amount) return;
    prepareMutation();
    let item = state.items.find((candidate) => normalize(candidate.name) === normalize(name));
    if (!item) {
      item = {
        id: makeId(name, category),
        name: name.toLocaleUpperCase("es"),
        category,
        source: "Añadido en la app",
        custom: true,
        amounts: { horno: "", parador: "", patio: "" },
        ordered: { horno: false, parador: false, patio: false },
      };
      state.items.push(item);
    }
    updateAmount(item, restaurantId, amount);
    item.ordered[restaurantId] = false;
    ui.restaurant = restaurantId;
    ui.view = "pending";
    ui.search = "";
    elements.addDialog.close();
    commit(`${item.name}: ${amount} para ${getRestaurant(restaurantId).name}`);
  });

  function assistantMessage(text, role) {
    const message = document.createElement("div");
    message.className = `assistant-message ${role === "user" ? "assistant-user" : "assistant-reply"}`;
    message.textContent = text;
    elements.assistantHistory.append(message);
    elements.assistantHistory.scrollTop = elements.assistantHistory.scrollHeight;
  }

  function detectRestaurant(command) {
    const text = normalize(command);
    if (/\bpatio\b|\brestaurante (3|tres)\b/.test(text)) return "patio";
    if (/\bparador\b|\brestaurante (2|dos)\b/.test(text)) return "parador";
    if (/\bhorno\b|\brestaurante (1|uno)\b/.test(text)) return "horno";
    return ui.restaurant === "all" ? "horno" : ui.restaurant;
  }

  function stem(token) {
    if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
    if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
    return token;
  }

  function findProduct(command) {
    const text = normalize(command);
    let best = null;
    let bestScore = 0;
    const stop = new Set(["de", "del", "la", "el", "para", "como", "pedido", "pedida", "pedir", "kilo", "kilos", "kg", "caja", "cajas", "unidad", "unidades"]);
    const commandTokens = new Set(text.split(" ").filter((token) => token.length > 2 && !stop.has(token)).map(stem));

    for (const item of state.items) {
      const name = normalize(item.name);
      let score = text.includes(name) ? 100 + name.length : 0;
      if (!score) {
        const tokens = name.split(" ").filter((token) => token.length > 2 && !stop.has(token)).map(stem);
        const hits = tokens.filter((token) => commandTokens.has(token)).length;
        score = tokens.length ? (hits / tokens.length) * 70 + hits : 0;
      }
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return bestScore >= 34 ? best : null;
  }

  function extractQuantity(command) {
    const text = normalize(command);
    const words = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
    const unitPattern = "kilos?|kg|k|cajas?|c|bandejas?|b|unidades?|uds?|rac(?:iones)?|tiras?|tern(?:eras?)?|cart(?:as?)?";
    let match = text.match(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})?\\b`));
    let number;
    let unit = "";
    if (match) {
      number = match[1].replace(".", ",");
      unit = match[2] ?? "";
    } else {
      for (const [word, value] of Object.entries(words)) {
        match = text.match(new RegExp(`\\b${word}\\s*(${unitPattern})?\\b`));
        if (match) {
          number = String(value);
          unit = match[1] ?? "";
          break;
        }
      }
    }
    if (!number) return "1";
    const unitMap = {
      kilo: "kg", kilos: "kg", kg: "kg", k: "kg",
      caja: "cajas", cajas: "cajas", c: "cajas",
      bandeja: "bandejas", bandejas: "bandejas", b: "bandejas",
      unidad: "uds", unidades: "uds", uds: "uds",
      rac: "raciones", racion: "raciones", raciones: "raciones",
      tira: "tiras", tiras: "tiras", tern: "tern", ternera: "tern", terneras: "tern",
      cart: "cart", carta: "cart", cartas: "cart",
    };
    return unit ? `${number} ${unitMap[unit] ?? unit}` : number;
  }

  function deriveProductName(command) {
    let text = normalize(command);
    text = text
      .replace(/\b(anade|anadir|agrega|agregar|pon|poner|apunta|apuntar|necesito|quiero|suma|echa|mete)\b/g, " ")
      .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
      .replace(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\b/g, " ")
      .replace(/\b(kilo|kilos|kg|k|caja|cajas|c|bandeja|bandejas|b|unidad|unidades|uds|racion|raciones|tira|tiras)\b/g, " ")
      .replace(/\b(horno|parador|patio|restaurante|uno|dos|tres)\b/g, " ")
      .replace(/\b(para|en|al|a|de|del|la|el|los|las)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text ? text.split(" ").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ") : "";
  }

  function executeAssistant(command) {
    const text = normalize(command);
    const restaurantId = detectRestaurant(command);
    const restaurant = getRestaurant(restaurantId);
    const item = findProduct(command);
    const isSearch = /\b(busca|buscar|muestra|mostrar|encuentra|ensen?a)\b/.test(text);
    const isUndoOrder = /\b(desmarca|destacha|pendiente|no pedido)\b/.test(text);
    const isOrder = /\b(marca|tacha|pedido|pedida|encargado|encargada)\b/.test(text);
    const isRemove = /\b(quita|quitar|elimina|eliminar|borra|borrar|vacia|vaciar)\b/.test(text);
    const isAdd = /\b(anade|anadir|agrega|agregar|pon|poner|apunta|apuntar|necesito|quiero|suma|echa|mete)\b/.test(text);

    if (isSearch) {
      const query = item?.name ?? text.replace(/\b(busca|buscar|muestra|mostrar|encuentra|ensena)\b/g, " ").trim();
      ui.search = query;
      ui.view = "catalog";
      render();
      return query ? `Te muestro lo que encuentro para “${query}”.` : "Dime qué producto quieres buscar.";
    }

    if ((isOrder || isUndoOrder) && /\b(todo|todos|toda|todas)\b/.test(text)) {
      prepareMutation();
      const targets = ui.restaurant === "all" && !/\b(horno|parador|patio|restaurante)\b/.test(text)
        ? state.restaurants.map((candidate) => candidate.id)
        : [restaurantId];
      let changed = 0;
      for (const product of state.items) {
        for (const targetId of targets) {
          if (!hasQuantity(product, targetId)) continue;
          product.ordered[targetId] = !isUndoOrder;
          changed += 1;
        }
      }
      commit();
      return `${changed} líneas ${isUndoOrder ? "han vuelto a pendientes" : "marcadas como pedidas"}.`;
    }

    if (isRemove) {
      if (!item) return "No he reconocido el producto que quieres quitar. Prueba a decir su nombre completo.";
      prepareMutation();
      if (/\b(catalogo|producto completo)\b/.test(text) && item.custom) {
        state.items = state.items.filter((candidate) => candidate.id !== item.id);
        commit();
        return `${item.name} se ha eliminado del catálogo.`;
      }
      updateAmount(item, restaurantId, "");
      commit();
      return `${item.name} se ha quitado de ${restaurant.name}.`;
    }

    if (isOrder || isUndoOrder) {
      if (!item) return "No he reconocido el producto. Prueba a decir “marca el salmón como pedido”.";
      if (!hasQuantity(item, restaurantId)) return `${item.name} no está ahora mismo en la lista de ${restaurant.name}.`;
      prepareMutation();
      item.ordered[restaurantId] = !isUndoOrder;
      commit();
      return `${item.name} ${isUndoOrder ? "vuelve a estar pendiente" : "queda marcado como pedido"} en ${restaurant.name}.`;
    }

    if (isAdd) {
      const amount = extractQuantity(command);
      let product = item;
      if (!product) {
        const name = deriveProductName(command);
        if (!name) return "No he entendido qué producto quieres añadir.";
        product = {
          id: makeId(name, "Polivalencia"),
          name: name.toLocaleUpperCase("es"),
          category: "Polivalencia",
          source: "Añadido por el asistente",
          custom: true,
          amounts: { horno: "", parador: "", patio: "" },
          ordered: { horno: false, parador: false, patio: false },
        };
        prepareMutation();
        state.items.push(product);
      } else {
        prepareMutation();
      }
      updateAmount(product, restaurantId, amount);
      product.ordered[restaurantId] = false;
      ui.restaurant = restaurantId;
      ui.view = "pending";
      ui.search = "";
      commit();
      return `He añadido ${amount} de ${product.name} para ${restaurant.name}.`;
    }

    return "Puedo ayudarte con frases como “añade 2 kilos de salmón para Patio”, “quita el pulpo” o “marca el bacalao como pedido”.";
  }

  function submitAssistant(text) {
    const command = text.trim();
    if (!command) return;
    assistantMessage(command, "user");
    elements.assistantInput.value = "";
    const commands = command.split(/[;\n]+/).map((part) => part.trim()).filter(Boolean);
    const replies = commands.map(executeAssistant);
    assistantMessage(replies.join(" "), "assistant");
  }

  elements.assistantButton.addEventListener("click", () => {
    elements.assistantDialog.showModal();
    window.setTimeout(() => elements.assistantInput.focus(), 50);
  });

  elements.assistantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAssistant(elements.assistantInput.value);
  });

  $$(".examples button").forEach((button) => button.addEventListener("click", () => submitAssistant(button.textContent)));

  function setupVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;
    recognition = new Recognition();
    recognition.lang = "es-ES";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onstart = () => {
      elements.micButton.classList.add("is-listening");
      elements.micButton.setAttribute("aria-label", "Escuchando; pulsa para parar");
      elements.assistantInput.placeholder = "Te escucho…";
    };
    recognition.onend = () => {
      elements.micButton.classList.remove("is-listening");
      elements.micButton.setAttribute("aria-label", "Hablar");
      elements.assistantInput.placeholder = "Escribe o usa el micrófono…";
    };
    recognition.onerror = (event) => {
      const message = event.error === "not-allowed"
        ? "Necesito permiso de micrófono. Actívalo en los ajustes del navegador."
        : "No he podido oírte bien. Puedes intentarlo otra vez o escribir la instrucción.";
      assistantMessage(message, "assistant");
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      submitAssistant(transcript);
    };
  }

  elements.micButton.addEventListener("click", () => {
    if (!recognition) {
      assistantMessage("La voz no está disponible en este navegador. En Android funciona mejor con Chrome y la aplicación instalada.", "assistant");
      return;
    }
    if (elements.micButton.classList.contains("is-listening")) recognition.stop();
    else recognition.start();
  });

  elements.undoButton.addEventListener("click", () => {
    if (!undoSnapshot) return;
    state = clone(undoSnapshot);
    undoSnapshot = null;
    elements.undoButton.hidden = true;
    save();
    render();
    assistantMessage("Cambio deshecho.", "assistant");
  });

  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$(`dialog`).forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));

  function buildShareText() {
    const lines = ["MERCAMADRID · LISTA SEMANAL"];
    for (const restaurant of state.restaurants) {
      const products = state.items.filter((item) => hasQuantity(item, restaurant.id));
      if (!products.length) continue;
      lines.push("", restaurant.name.toLocaleUpperCase("es"));
      for (const item of products) {
        lines.push(`${item.ordered[restaurant.id] ? "✓" : "☐"} ${item.amounts[restaurant.id]} · ${item.name}`);
      }
    }
    return lines.join("\n");
  }

  $("#share-button").addEventListener("click", async () => {
    const text = buildShareText();
    try {
      if (navigator.share) await navigator.share({ title: "Lista Mercamadrid", text });
      else {
        await navigator.clipboard.writeText(text);
        showToast("Lista copiada; ya puedes pegarla donde quieras");
      }
    } catch (error) {
      if (error.name !== "AbortError") showToast("No se ha podido compartir la lista");
    }
  });

  elements.manageButton.addEventListener("click", () => elements.manageDialog.showModal());

  $("#new-week-button").addEventListener("click", () => {
    if (!window.confirm("¿Empezar una nueva semana? Se vaciarán todas las cantidades y marcas de pedido.")) return;
    prepareMutation();
    for (const item of state.items) {
      for (const restaurant of state.restaurants) {
        item.amounts[restaurant.id] = "";
        item.ordered[restaurant.id] = false;
      }
    }
    elements.manageDialog.close();
    commit("Nueva semana preparada");
  });

  $("#backup-button").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `merca-facil-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Copia guardada");
  });

  $("#restore-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const restored = JSON.parse(await file.text());
      if (!Array.isArray(restored.items) || !Array.isArray(restored.restaurants)) throw new Error("Formato no válido");
      prepareMutation();
      state = restored;
      elements.manageDialog.close();
      commit("Copia recuperada");
    } catch {
      showToast("Ese archivo no es una copia válida");
    } finally {
      event.target.value = "";
    }
  });

  $("#restore-excel-button").addEventListener("click", () => {
    if (!window.confirm("¿Restaurar los datos originales del Excel? Los cambios guardados en la app se perderán.")) return;
    prepareMutation();
    state = clone(seed);
    elements.manageDialog.close();
    commit("Lista original restaurada");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    elements.installButton.hidden = false;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    elements.installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => showToast("Merca Fácil instalada"));

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  populateAddForm();
  setupVoice();
  render();
})();
