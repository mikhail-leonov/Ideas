/* ===================== i18n engine ===================== */
window.FT = window.FT || {};
(function (FT) {
  "use strict";
  var packs = {}, currentLang = "en", listeners = [];
  function register(code, data) { packs[code] = data || { strings: {} }; }
  function t(key, vars) {
    var pack = packs[currentLang] || packs.en || { strings: {} };
    var fallback = packs.en || { strings: {} };
    var str = (pack.strings && pack.strings[key]) || (fallback.strings && fallback.strings[key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) {
      str = str.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    });
    return str;
  }
  function applyToDom(root) {
    var scope = root || document;
    document.documentElement.lang = currentLang;
    document.documentElement.dir = (packs[currentLang] && packs[currentLang].dir) || "ltr";
    scope.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder"))); });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) { el.setAttribute("title", t(el.getAttribute("data-i18n-title"))); });
  }
  function setLang(code) {
    if (!packs[code]) return;
    currentLang = code;
    try { localStorage.setItem("ft_lang", code); } catch (e) {}
    applyToDom();
    listeners.forEach(function (fn) { fn(code); });
  }
  function init() {
    var saved = null;
    try { saved = localStorage.getItem("ft_lang"); } catch (e) {}
    if (saved && packs[saved]) currentLang = saved;
    else {
      var nav = ((navigator.language || "en").split("-")[0] || "en").toLowerCase();
      if (packs[nav]) currentLang = nav;
    }
    applyToDom();
  }
  function availableLanguages() {
    return Object.keys(packs).map(function (code) {
      return { code: code, name: packs[code].name, nativeName: packs[code].nativeName };
    });
  }
  function onChange(fn) { listeners.push(fn); }
  FT.I18n = { register: register, t: t, setLang: setLang, init: init, applyToDom: applyToDom, availableLanguages: availableLanguages, onChange: onChange, getCurrentLang: function () { return currentLang; } };
})(window.FT);


window.FT = window.FT || {};
(function (FT) {
"use strict";
var LARGE_FILE_BYTES = 2 * 1024 * 1024;
var cy = null, data = null, dirty = false;
var selectedNodeId = null, selectedEdgeKey = null;
var connectMode = false, connectFirstId = null;
var pendingAttachment = null;
var els = {};

function newId(prefix) { return (prefix || "node") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function emptyMap() { return { version: 1, title: FT.I18n.t("app.untitledMap"), rootId: null, nodes: [], connections: [] }; }
function findNode(id) { return data.nodes.find(function (n) { return n.id === id; }); }
function edgeKey(a, b) { return a + "|" + b; }
function connectionExists(a, b) { return data.connections.some(function (c) { return (c.source === a && c.target === b) || (c.source === b && c.target === a); }); }
function markDirty() { dirty = true; updateTitleBar(); }
function clearDirty() { dirty = false; updateTitleBar(); }
function updateTitleBar() { els.mapTitleDisplay.textContent = data.title + (dirty ? " *" : ""); }

function nodeLabel(n) {
  var lines = [n.title || FT.I18n.t("app.newNodeTitle")];
  var badges = [];
  if (n.images && n.images.length) badges.push("🖼" + n.images.length);
  if (n.audio && n.audio.length) badges.push("🎵" + n.audio.length);
  if (n.video && n.video.length) badges.push("🎬" + n.video.length);
  if (n.files && n.files.length) badges.push("📎" + n.files.length);
  if (badges.length) lines.push(badges.join("  "));
  return lines.join("\n");
}
function toElements() {
  var out = data.nodes.map(function (n) {
    return { data: { id: n.id, label: nodeLabel(n) }, position: { x: n.x || 0, y: n.y || 0 } };
  });
  data.connections.forEach(function (c) {
    out.push({ data: { id: edgeKey(c.source, c.target), source: c.source, target: c.target } });
  });
  return out;
}
function cyStyle() {
  return [
    { selector: "node", style: { "shape": "round-rectangle", "background-color": "#0d6efd", "label": "data(label)", "color": "#ffffff", "text-wrap": "wrap", "text-max-width": "140px", "width": "label", "height": "label", "padding": "12px", "text-valign": "center", "text-halign": "center", "font-size": 12, "border-width": 0 } },
    { selector: "node:selected", style: { "background-color": "#ffc107", "color": "#212529", "border-width": 3, "border-color": "#fd7e14" } },
    { selector: "node.search-highlight", style: { "border-width": 4, "border-color": "#198754" } },
    { selector: "node.connect-candidate", style: { "border-width": 4, "border-color": "#0dcaf0" } },
    { selector: "edge", style: { "width": 2, "line-color": "#6c757d", "target-arrow-color": "#6c757d", "target-arrow-shape": "triangle", "curve-style": "bezier" } },
    { selector: "edge:selected", style: { "line-color": "#dc3545", "target-arrow-color": "#dc3545", "width": 3 } }
  ];
}
function initCytoscape() {
  cy = window.cytoscape({ container: els.cyContainer, elements: [], style: cyStyle(), wheelSensitivity: 0.25 });
  cy.on("tap", "node", function (evt) { selectNode(evt.target.id()); });
  cy.on("tap", "edge", function (evt) { var e = evt.target; selectEdge(e.data("source"), e.data("target")); });
  cy.on("tap", function (evt) { if (evt.target === cy) { if (connectMode) return; deselectAll(); } });
  cy.on("dbltap", "node", function (evt) { selectNode(evt.target.id()); openEditNodeModal(); });
  cy.on("dbltap", function (evt) {
    if (evt.target === cy) {
      var pos = evt.position;
      if (pos) openAddNodeModalAt(pos.x, pos.y);
      else openAddNodeModal();
    }
  });
  cy.on("dragfree", "node", function (evt) {
    var n = findNode(evt.target.id()); if (!n) return;
    var p = evt.target.position(); n.x = p.x; n.y = p.y; markDirty();
  });
  cy.on("cxttap", "node", function (evt) { evt.originalEvent.preventDefault(); selectNode(evt.target.id()); showContextMenu(evt.originalEvent, "node", evt.target.id()); });
  cy.on("cxttap", "edge", function (evt) { evt.originalEvent.preventDefault(); var e = evt.target; selectEdge(e.data("source"), e.data("target")); showContextMenu(evt.originalEvent, "edge", edgeKey(e.data("source"), e.data("target"))); });
  cy.on("cxttap", function (evt) {
    if (evt.target === cy) {
      evt.originalEvent.preventDefault();
      var pos = evt.renderedPosition || { x: evt.originalEvent.clientX, y: evt.originalEvent.clientY };
      showContextMenu({ clientX: pos.x, clientY: pos.y, _canvasPos: evt.position }, "canvas");
    }
  });
  els.cyContainer.addEventListener("contextmenu", function (e) { e.preventDefault(); });
}
function rebuildGraph(fit) {
  cy.elements().remove();
  cy.add(toElements());
  var hasCoords = data.nodes.length && data.nodes.some(function (n) { return typeof n.x === "number" && typeof n.y === "number" && (n.x !== 0 || n.y !== 0); });
  if (!hasCoords && data.nodes.length) runLayout(false);
  if (fit !== false) cy.fit(undefined, 40);
  if (data.rootId && findNode(data.rootId)) selectNode(data.rootId);
}
function runLayout(markAsDirty) {
  var name = data.rootId && findNode(data.rootId) ? "breadthfirst" : "cose";
  var opts = { name: name, animate: false, fit: false, padding: 30 };
  if (name === "breadthfirst") { opts.roots = "#" + cssEscape(data.rootId); opts.directed = true; }
  var layout = cy.layout(opts); layout.run();
  cy.nodes().forEach(function (ele) {
    var n = findNode(ele.id()); if (!n) return;
    var p = ele.position(); n.x = p.x; n.y = p.y;
  });
  if (markAsDirty !== false) markDirty();
}
function cssEscape(s) { return String(s).replace(/([ #.;?%&,+*~':"!^$\[\]()=>|\/@])/g, "\\$1"); }

function deselectAll() {
  selectedNodeId = null; selectedEdgeKey = null;
  cy.elements().unselect();
  renderSidebarEmpty();
  updateActionButtons();
}
function selectNode(id) {
  selectedEdgeKey = null; selectedNodeId = id;
  cy.elements().unselect();
  var ele = cy.getElementById(id); if (ele && ele.length) ele.select();
  renderSidebarForNode(findNode(id));
  updateActionButtons();
  if (connectMode) handleConnectClick(id);
}
function selectEdge(source, target) {
  selectedNodeId = null; selectedEdgeKey = edgeKey(source, target);
  cy.elements().unselect();
  var ele = cy.getElementById(selectedEdgeKey); if (ele && ele.length) ele.select();
  renderSidebarForEdge(source, target);
  updateActionButtons();
}
function updateActionButtons() {
  if (els.menuEditNode) els.menuEditNode.disabled = !selectedNodeId;
  if (els.menuDeleteNode) els.menuDeleteNode.disabled = !selectedNodeId;
  if (els.menuDeleteConnection) els.menuDeleteConnection.disabled = !selectedEdgeKey;
}

/* ===== Sidebar ===== */
function renderSidebarEmpty() {
  els.sidebar.innerHTML = '<p class="text-muted" data-i18n="sidebar.emptyState">' + FT.I18n.t("sidebar.emptyState") + "</p>";
}
function attachmentSectionHtml(node, kind, labelKey, accept) {
  var items = node[kind] || [];
  var listHtml = items.length ? items.map(function (att, idx) {
    var meta = '<div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">';
    var body = "";
    if (kind === "images") body = att.dataUrl ? '<img src="' + att.dataUrl + '" class="img-thumbnail me-2" style="width:48px;height:48px;object-fit:cover;">' : '<i class="bi bi-image me-2 fs-4"></i>';
    else if (kind === "audio" && att.dataUrl) body = '<audio controls src="' + att.dataUrl + '" class="me-2" style="max-width:160px;height:32px;"></audio>';
    else if (kind === "video" && att.dataUrl) body = '<video controls src="' + att.dataUrl + '" class="me-2" style="max-width:160px;max-height:80px;"></video>';
    else body = '<i class="bi bi-paperclip me-2 fs-4"></i>';
    var name = '<div class="small"><div class="text-truncate" style="max-width:140px;" title="' + escapeHtml(att.name) + '">' + escapeHtml(att.name) + '</div><span class="badge text-bg-' + (att.dataUrl ? "success" : "secondary") + '">' + FT.I18n.t(att.dataUrl ? "sidebar.embedded" : "sidebar.metadataOnly") + "</span></div>";
    var actions = '<div class="ms-2 d-flex flex-column gap-1">';
    if (att.dataUrl) actions += '<a class="btn btn-sm btn-outline-secondary" download="' + escapeHtml(att.name) + '" href="' + att.dataUrl + '" data-i18n="sidebar.download">' + FT.I18n.t("sidebar.download") + "</a>";
    actions += '<button type="button" class="btn btn-sm btn-outline-danger" data-remove-att="' + kind + '" data-idx="' + idx + '" data-i18n="sidebar.remove">' + FT.I18n.t("sidebar.remove") + "</button></div>";
    return meta + '<div class="d-flex align-items-center">' + body + name + "</div>" + actions + "</div>";
  }).join("") : '<p class="text-muted small" data-i18n="sidebar.noAttachments">' + FT.I18n.t("sidebar.noAttachments") + "</p>";
  return '<div class="mb-3"><h6 class="mb-2" data-i18n="' + labelKey + '">' + FT.I18n.t(labelKey) + "</h6>" + listHtml + '<input type="file" multiple class="form-control form-control-sm" data-add-att="' + kind + '" accept="' + accept + '"></div>';
}
function renderSidebarForNode(node) {
  if (!node) { renderSidebarEmpty(); return; }
  var connections = data.connections.filter(function (c) { return c.source === node.id || c.target === node.id; });
  var connHtml = connections.length ? '<div class="list-group">' + connections.map(function (c) {
    var otherId = c.source === node.id ? c.target : c.source;
    var other = findNode(otherId);
    return '<button type="button" class="list-group-item list-group-item-action" data-goto-node="' + otherId + '">' + escapeHtml(other ? other.title : otherId) + "</button>";
  }).join("") + "</div>" : '<p class="text-muted small" data-i18n="sidebar.noConnections">' + FT.I18n.t("sidebar.noConnections") + "</p>";
  els.sidebar.innerHTML =
    '<div class="card mb-3"><div class="card-body"><h5 class="card-title" data-i18n="sidebar.infoTitle">' + FT.I18n.t("sidebar.infoTitle") + "</h5>" +
    '<p class="mb-1"><strong data-i18n="sidebar.titleLabel">' + FT.I18n.t("sidebar.titleLabel") + "</strong>: " + escapeHtml(node.title || "") + "</p>" +
    '<p class="mb-1"><strong data-i18n="sidebar.descriptionLabel">' + FT.I18n.t("sidebar.descriptionLabel") + "</strong>: " + escapeHtml(node.description || "") + "</p>" +
    '<p class="mb-0 text-muted small"><strong data-i18n="sidebar.idLabel">' + FT.I18n.t("sidebar.idLabel") + "</strong>: " + escapeHtml(node.id) + "</p></div></div>" +
    '<h6 class="mb-2" data-i18n="sidebar.attachmentsTitle">' + FT.I18n.t("sidebar.attachmentsTitle") + "</h6>" +
    attachmentSectionHtml(node, "images", "sidebar.images", "image/*") +
    attachmentSectionHtml(node, "audio", "sidebar.audio", "audio/*") +
    attachmentSectionHtml(node, "video", "sidebar.video", "video/*") +
    attachmentSectionHtml(node, "files", "sidebar.files", "*/*") +
    '<h6 class="mb-2" data-i18n="sidebar.connectionsTitle">' + FT.I18n.t("sidebar.connectionsTitle") + "</h6>" + connHtml;
  bindSidebarEvents(node);
}
function renderSidebarForEdge(source, target) {
  var s = findNode(source), t = findNode(target);
  els.sidebar.innerHTML =
    '<div class="card"><div class="card-body"><h5 class="card-title" data-i18n="sidebar.edgeSelectedTitle">' + FT.I18n.t("sidebar.edgeSelectedTitle") + "</h5>" +
    '<p class="mb-1"><strong data-i18n="sidebar.edgeSource">' + FT.I18n.t("sidebar.edgeSource") + "</strong>: " + escapeHtml(s ? s.title : source) + "</p>" +
    '<p class="mb-0"><strong data-i18n="sidebar.edgeTarget">' + FT.I18n.t("sidebar.edgeTarget") + "</strong>: " + escapeHtml(t ? t.title : target) + "</p></div></div>";
}
function bindSidebarEvents(node) {
  els.sidebar.querySelectorAll("[data-goto-node]").forEach(function (btn) {
    btn.addEventListener("click", function () { var id = btn.getAttribute("data-goto-node"); selectNode(id); centerOn(id); });
  });
  els.sidebar.querySelectorAll("[data-remove-att]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var kind = btn.getAttribute("data-remove-att"); var idx = parseInt(btn.getAttribute("data-idx"), 10);
      node[kind].splice(idx, 1); markDirty(); refreshNodeVisual(node); renderSidebarForNode(node);
    });
  });
  els.sidebar.querySelectorAll("[data-add-att]").forEach(function (input) {
    input.addEventListener("change", function () {
      handleAttachmentFiles(node, input.getAttribute("data-add-att"), input.files).then(function () {
        markDirty(); refreshNodeVisual(node); renderSidebarForNode(node);
      });
    });
  });
}
function centerOn(id) {
  var ele = cy.getElementById(id); if (!ele || !ele.length) return;
  cy.animate({ center: { eles: ele }, zoom: Math.max(cy.zoom(), 1) }, { duration: 200 });
}
function refreshNodeVisual(node) { var ele = cy.getElementById(node.id); if (ele && ele.length) ele.data("label", nodeLabel(node)); }
function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function humanSize(bytes) { if (bytes < 1024) return bytes + " B"; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }

/* ===== Attachments ===== */
function handleAttachmentFiles(node, kind, fileList) {
  var files = Array.prototype.slice.call(fileList || []);
  return files.reduce(function (chain, file) { return chain.then(function () { return addOneAttachment(node, kind, file); }); }, Promise.resolve());
}
function addOneAttachment(node, kind, file) {
  return decideEmbedding(file).then(function (embed) {
    var meta = { name: file.name, type: file.type, size: file.size };
    if (!embed) { node[kind].push(meta); return; }
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { meta.dataUrl = reader.result; node[kind].push(meta); resolve(); };
      reader.onerror = function () { node[kind].push(meta); resolve(); };
      reader.readAsDataURL(file);
    });
  });
}
function decideEmbedding(file) {
  if (file.size < LARGE_FILE_BYTES) return Promise.resolve(true);
  return new Promise(function (resolve) {
    els.largeAttName.textContent = file.name;
    els.largeAttBody.textContent = FT.I18n.t("modal.largeAttachmentBody", { name: file.name, size: humanSize(file.size) });
    pendingAttachment = { resolve: resolve };
    els.largeAttModal.show();
  });
}

/* ===== Node CRUD ===== */
var nodeModalMode = "add", nodeModalTargetId = null, pendingAddPosition = null;
function openAddNodeModal() { pendingAddPosition = null; _openAddNodeModal(); }
function openAddNodeModalAt(x, y) { pendingAddPosition = { x: x, y: y }; _openAddNodeModal(); }
function _openAddNodeModal() {
  nodeModalMode = "add"; nodeModalTargetId = null;
  els.nodeModalLabel.textContent = FT.I18n.t("modal.addNodeTitle");
  els.nodeTitleInput.value = ""; els.nodeDescInput.value = "";
  els.connectToSelectedWrap.classList.toggle("d-none", !selectedNodeId);
  els.connectToSelectedInput.checked = !!selectedNodeId;
  els.nodeModal.show();
  setTimeout(function () { els.nodeTitleInput.focus(); }, 200);
}
function openEditNodeModal() {
  if (!selectedNodeId) return;
  var n = findNode(selectedNodeId); if (!n) return;
  nodeModalMode = "edit"; nodeModalTargetId = n.id;
  els.nodeModalLabel.textContent = FT.I18n.t("modal.editNodeTitle");
  els.nodeTitleInput.value = n.title || ""; els.nodeDescInput.value = n.description || "";
  els.connectToSelectedWrap.classList.add("d-none");
  els.nodeModal.show();
  setTimeout(function () { els.nodeTitleInput.focus(); }, 200);
}
function submitNodeModal() {
  var title = els.nodeTitleInput.value.trim() || FT.I18n.t("app.newNodeTitle");
  var desc = els.nodeDescInput.value.trim();
  if (nodeModalMode === "edit" && nodeModalTargetId) {
    var n = findNode(nodeModalTargetId); n.title = title; n.description = desc;
    refreshNodeVisual(n);
    if (selectedNodeId === n.id) renderSidebarForNode(n);
    markDirty();
  } else {
    var id = newId("node"); var prevSelected = selectedNodeId;
    var pos = pendingAddPosition || { x: 0, y: 0 };
    if (!pendingAddPosition) {
      var ele = prevSelected ? cy.getElementById(prevSelected) : null;
      if (ele && ele.length) { var p = ele.position(); pos = { x: p.x + 120, y: p.y + 60 }; }
      else if (cy.nodes().length) { var ext = cy.extent(); pos = { x: (ext.x1 + ext.x2) / 2, y: (ext.y1 + ext.y2) / 2 }; }
    }
    var newNode = { id: id, title: title, description: desc, x: pos.x, y: pos.y, images: [], audio: [], video: [], files: [] };
    data.nodes.push(newNode);
    if (!data.rootId) data.rootId = id;
    cy.add({ data: { id: id, label: nodeLabel(newNode) }, position: pos });
    cy.getElementById(id).grabify();
    if (prevSelected && !els.connectToSelectedWrap.classList.contains("d-none") && els.connectToSelectedInput.checked) addConnection(prevSelected, id);
    markDirty(); selectNode(id);
  }
  pendingAddPosition = null;
  els.nodeModal.hide();
}
function requestDeleteNode() { if (!selectedNodeId) return; els.deleteNodeModal.show(); }
function confirmDeleteNode() {
  var id = selectedNodeId; if (!id) { els.deleteNodeModal.hide(); return; }
  data.nodes = data.nodes.filter(function (n) { return n.id !== id; });
  data.connections = data.connections.filter(function (c) { return c.source !== id && c.target !== id; });
  if (data.rootId === id) data.rootId = data.nodes.length ? data.nodes[0].id : null;
  cy.getElementById(id).connectedEdges().remove(); cy.getElementById(id).remove();
  deselectAll(); markDirty(); els.deleteNodeModal.hide();
}

/* ===== Connect mode ===== */
function toggleConnectMode() {
  connectMode = !connectMode; connectFirstId = null;
  cy.nodes().removeClass("connect-candidate");
  els.connectModeBanner.classList.toggle("d-none", !connectMode);
  els.connectModeBanner.textContent = FT.I18n.t("connect.bannerSelectFirst");
}
function cancelConnectMode() {
  connectMode = false; connectFirstId = null;
  cy.nodes().removeClass("connect-candidate");
  els.connectModeBanner.classList.add("d-none");
}
function handleConnectClick(id) {
  if (!connectFirstId) {
    connectFirstId = id;
    cy.getElementById(id).addClass("connect-candidate");
    els.connectModeBanner.textContent = FT.I18n.t("connect.bannerSelectSecond");
    return;
  }
  if (connectFirstId === id) return;
  addConnection(connectFirstId, id, true);
  cy.nodes().removeClass("connect-candidate");
  connectFirstId = null;
  els.connectModeBanner.textContent = FT.I18n.t("connect.bannerSelectFirst");
}
function addConnection(source, target, showWarnings) {
  if (source === target) { if (showWarnings) showAlert("warning", FT.I18n.t("connect.selfNotAllowed")); return false; }
  if (connectionExists(source, target)) { if (showWarnings) showAlert("warning", FT.I18n.t("connect.duplicate")); return false; }
  data.connections.push({ source: source, target: target });
  cy.add({ data: { id: edgeKey(source, target), source: source, target: target } });
  markDirty(); return true;
}
function requestDeleteConnection() {
  if (!selectedEdgeKey) return;
  data.connections = data.connections.filter(function (c) { return edgeKey(c.source, c.target) !== selectedEdgeKey; });
  cy.getElementById(selectedEdgeKey).remove();
  selectedEdgeKey = null; renderSidebarEmpty(); updateActionButtons(); markDirty();
}

/* ===== Context menu ===== */
function hideContextMenu() { els.ctxMenu.classList.add("d-none"); els.ctxMenu.innerHTML = ""; }
function showContextMenu(evt, kind, target) {
  hideContextMenu();
  var items = [];
  if (kind === "node") {
    items.push({ label: FT.I18n.t("ctx.editNode"), action: "editNode", shortcut: "E" });
    items.push({ label: FT.I18n.t("ctx.deleteNode"), action: "deleteNode", shortcut: "Del", danger: true });
    items.push({ divider: true });
    items.push({ label: FT.I18n.t("ctx.connectFrom"), action: "connectFromHere" });
  } else if (kind === "edge") {
    items.push({ label: FT.I18n.t("ctx.deleteEdge"), action: "deleteEdge", shortcut: "Del", danger: true });
  } else {
    items.push({ label: FT.I18n.t("ctx.addNode"), action: "addNodeHere", shortcut: "N" });
    items.push({ divider: true });
    items.push({ label: FT.I18n.t("ctx.fitMap"), action: "fitMap", shortcut: "F" });
    items.push({ label: FT.I18n.t("ctx.autoLayout"), action: "autoLayout", shortcut: "L" });
  }
  items.forEach(function (it) {
    if (it.divider) { var d = document.createElement("li"); d.innerHTML = '<hr class="dropdown-divider">'; els.ctxMenu.appendChild(d); return; }
    var li = document.createElement("li");
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "dropdown-item" + (it.danger ? " text-danger" : "");
    btn.innerHTML = '<span>' + it.label + '</span>' + (it.shortcut ? '<span class="shortcut">' + it.shortcut + '</span>' : '');
    btn.addEventListener("click", function () {
      hideContextMenu();
      if (it.action === "editNode") openEditNodeModal();
      else if (it.action === "deleteNode") requestDeleteNode();
      else if (it.action === "deleteEdge") requestDeleteConnection();
      else if (it.action === "connectFromHere") { if (!connectMode) toggleConnectMode(); handleConnectClick(target); }
      else if (it.action === "addNodeHere") { if (evt._canvasPos) openAddNodeModalAt(evt._canvasPos.x, evt._canvasPos.y); else openAddNodeModal(); }
      else if (it.action === "fitMap") cy.fit(undefined, 40);
      else if (it.action === "autoLayout") { runLayout(true); cy.fit(undefined, 40); }
    });
    li.appendChild(btn); els.ctxMenu.appendChild(li);
  });
  var x = evt.clientX || 0, y = evt.clientY || 0;
  els.ctxMenu.style.left = x + "px"; els.ctxMenu.style.top = y + "px";
  els.ctxMenu.classList.remove("d-none");
  requestAnimationFrame(function () {
    var r = els.ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth) els.ctxMenu.style.left = Math.max(0, window.innerWidth - r.width - 4) + "px";
    if (r.bottom > window.innerHeight) els.ctxMenu.style.top = Math.max(0, window.innerHeight - r.height - 4) + "px";
  });
}

/* ===== New / Open / Save ===== */
function requestNewMap() { if (dirty) { els.newMapModal.show(); return; } doNewMap(); }
function doNewMap() {
  data = emptyMap(); cancelConnectMode(); deselectAll(); rebuildGraph(true); clearDirty();
  els.newMapModal.hide(); showAlert("success", FT.I18n.t("alert.mapCreated"));
}
function openJsonFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = JSON.parse(reader.result); } catch (e) { showAlert("danger", FT.I18n.t("alert.invalidJson")); return; }
    var result = normalizeMap(parsed);
    if (!result.ok) { showAlert("danger", FT.I18n.t("alert.invalidStructure")); return; }
    data = result.map; cancelConnectMode(); rebuildGraph(true); clearDirty();
    result.notices.forEach(function (msg) { showAlert("warning", msg); });
    showAlert("success", FT.I18n.t("alert.mapOpened"));
  };
  reader.onerror = function () { showAlert("danger", FT.I18n.t("alert.invalidJson")); };
  reader.readAsText(file);
}
function normalizeMap(raw) {
  var notices = [];
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) return { ok: false };
  var map = { version: raw.version || 1, title: typeof raw.title === "string" && raw.title.trim() ? raw.title : FT.I18n.t("app.untitledMap"), rootId: raw.rootId || null, nodes: [], connections: [] };
  var seenIds = {}, missingIdCount = 0, dupIdCount = 0;
  (raw.nodes || []).forEach(function (n) {
    if (!n || typeof n !== "object") return;
    var id = n.id;
    if (!id) { id = newId("node"); missingIdCount++; }
    if (seenIds[id]) { id = newId("node"); dupIdCount++; }
    seenIds[id] = true;
    map.nodes.push({ id: id, title: typeof n.title === "string" ? n.title : "", description: typeof n.description === "string" ? n.description : "", x: typeof n.x === "number" ? n.x : 0, y: typeof n.y === "number" ? n.y : 0, images: Array.isArray(n.images) ? n.images : [], audio: Array.isArray(n.audio) ? n.audio : [], video: Array.isArray(n.video) ? n.video : [], files: Array.isArray(n.files) ? n.files : [] });
  });
  var validIds = {}; map.nodes.forEach(function (n) { validIds[n.id] = true; });
  var invalidConnCount = 0, seenConn = {};
  (raw.connections || []).forEach(function (c) {
    if (!c || !validIds[c.source] || !validIds[c.target]) { invalidConnCount++; return; }
    var key = edgeKey(c.source, c.target), revKey = edgeKey(c.target, c.source);
    if (seenConn[key] || seenConn[revKey]) return;
    seenConn[key] = true; map.connections.push({ source: c.source, target: c.target });
  });
  if (!map.rootId || !validIds[map.rootId]) map.rootId = map.nodes.length ? map.nodes[0].id : null;
  if (missingIdCount) notices.push(FT.I18n.t("alert.missingIdsGenerated", { count: missingIdCount }));
  if (dupIdCount) notices.push(FT.I18n.t("alert.duplicateIdsFixed", { count: dupIdCount }));
  if (invalidConnCount) notices.push(FT.I18n.t("alert.invalidConnectionsRemoved", { count: invalidConnCount }));
  return { ok: true, map: map, notices: notices };
}
function syncPositionsFromCy() {
  cy.nodes().forEach(function (ele) { var n = findNode(ele.id()); if (!n) return; var p = ele.position(); n.x = p.x; n.y = p.y; });
}
function saveJson() {
  syncPositionsFromCy();
  var json = JSON.stringify(data, null, 2);
  var blob = new Blob([json], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var filename = (data.title || "mind-map").trim().replace(/[^a-z0-9\-_]+/gi, "-").replace(/-+/g, "-") + ".json";
  var a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url); clearDirty();
  showAlert("success", FT.I18n.t("alert.savedOk", { filename: filename }));
}

/* ===== Search ===== */
function runSearch(term) {
  cy.nodes().removeClass("search-highlight");
  term = term.trim().toLowerCase();
  els.searchResults.innerHTML = ""; els.searchResults.classList.add("d-none");
  if (!term) return;
  var matches = data.nodes.filter(function (n) { return (n.title || "").toLowerCase().indexOf(term) !== -1 || (n.description || "").toLowerCase().indexOf(term) !== -1; });
  matches.forEach(function (n) { cy.getElementById(n.id).addClass("search-highlight"); });
  if (!matches.length) return;
  els.searchResults.classList.remove("d-none");
  matches.slice(0, 20).forEach(function (n) {
    var item = document.createElement("button"); item.type = "button"; item.className = "list-group-item list-group-item-action";
    item.textContent = n.title || n.id;
    item.addEventListener("click", function () { selectNode(n.id); centerOn(n.id); els.searchResults.classList.add("d-none"); els.searchInput.value = ""; cy.nodes().removeClass("search-highlight"); });
    els.searchResults.appendChild(item);
  });
}

/* ===== Alerts ===== */
function showAlert(type, message) {
  if (!message) return;
  var div = document.createElement("div");
  div.className = "alert alert-" + type + " alert-dismissible fade show shadow-sm";
  div.setAttribute("role", "alert"); div.textContent = message;
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "btn-close"; btn.setAttribute("data-bs-dismiss", "alert");
  div.appendChild(btn); els.alertContainer.appendChild(div);
  setTimeout(function () { if (div.parentNode) { try { bootstrap.Alert.getOrCreateInstance(div).close(); } catch (e) { div.remove(); } } }, 6000);
}

/* ===== Map title ===== */
function openMapTitleEdit() { els.mapTitleInput.value = data.title || ""; els.mapTitleModal.show(); }
function submitMapTitle() { var t = els.mapTitleInput.value.trim(); if (t) { data.title = t; markDirty(); updateTitleBar(); } els.mapTitleModal.hide(); }

/* ===== Help ===== */
function showHelp() { var m = new bootstrap.Modal(document.getElementById("helpModal")); m.show(); }

/* ===== Keyboard shortcuts ===== */
function isTypingTarget(el) { return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); }
function bindShortcuts() {
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (connectMode) { cancelConnectMode(); return; } hideContextMenu(); }
    var typing = isTypingTarget(document.activeElement);
    if (typing && e.key !== "Escape") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveJson(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); els.fileInputJson.click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); requestNewMap(); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedNodeId) { e.preventDefault(); requestDeleteNode(); return; }
      if (selectedEdgeKey) { e.preventDefault(); requestDeleteConnection(); return; }
    }
    if (typing) return;
    var k = e.key;
    if (k === "+") { cy.zoom(cy.zoom() * 1.2); return; }
    if (k === "-" || k === "−") { cy.zoom(cy.zoom() / 1.2); return; }
    var lower = k.toLowerCase();
    if (lower === "f") { cy.fit(undefined, 40); return; }
    if (lower === "n") { openAddNodeModal(); return; }
    if (lower === "e") { if (selectedNodeId) openEditNodeModal(); return; }
    if (lower === "c") { toggleConnectMode(); return; }
    if (lower === "l") { runLayout(true); cy.fit(undefined, 40); return; }
    if (lower === "t") { openMapTitleEdit(); return; }
    if (k === "/" ) { e.preventDefault(); els.searchInput.focus(); return; }
    if (k === "?" || k === "F1") { e.preventDefault(); showHelp(); return; }
  });
}

/* ===== Menu actions dispatcher ===== */
function bindMenuActions() {
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var action = btn.getAttribute("data-action");
      switch (action) {
        case "newMap": requestNewMap(); break;
        case "openJson": els.fileInputJson.click(); break;
        case "saveJson": saveJson(); break;
        case "editMapTitle": openMapTitleEdit(); break;
        case "addNode": openAddNodeModal(); break;
        case "editNode": openEditNodeModal(); break;
        case "deleteNode": requestDeleteNode(); break;
        case "connectNodes": toggleConnectMode(); break;
        case "deleteConnection": requestDeleteConnection(); break;
        case "fitMap": cy.fit(undefined, 40); break;
        case "zoomIn": cy.zoom(cy.zoom() * 1.2); break;
        case "zoomOut": cy.zoom(cy.zoom() / 1.2); break;
        case "autoLayout": runLayout(true); cy.fit(undefined, 40); break;
        case "showHelp": showHelp(); break;
      }
    });
  });
}

/* ===== Init ===== */
function cacheEls() {
  els.cyContainer = document.getElementById("cy");
  els.mapTitleDisplay = document.getElementById("mapTitleDisplay");
  els.sidebar = document.getElementById("sidebar");
  els.alertContainer = document.getElementById("alertContainer");
  els.connectModeBanner = document.getElementById("connectModeBanner");
  els.searchInput = document.getElementById("searchInput");
  els.searchResults = document.getElementById("searchResults");
  els.fileInputJson = document.getElementById("fileInputJson");
  els.langMenu = document.getElementById("langMenu");
  els.ctxMenu = document.getElementById("ctxMenu");
  els.menuEditNode = document.getElementById("menuEditNode");
  els.menuDeleteNode = document.getElementById("menuDeleteNode");
  els.menuDeleteConnection = document.getElementById("menuDeleteConnection");
  els.nodeModalLabel = document.getElementById("nodeModalLabel");
  els.nodeTitleInput = document.getElementById("nodeTitleInput");
  els.nodeDescInput = document.getElementById("nodeDescInput");
  els.connectToSelectedWrap = document.getElementById("connectToSelectedWrap");
  els.connectToSelectedInput = document.getElementById("connectToSelectedInput");
  els.btnNodeModalSave = document.getElementById("btnNodeModalSave");
  els.nodeModal = new bootstrap.Modal(document.getElementById("nodeModal"));
  els.deleteNodeModal = new bootstrap.Modal(document.getElementById("deleteNodeModal"));
  els.btnConfirmDeleteNode = document.getElementById("btnConfirmDeleteNode");
  els.newMapModal = new bootstrap.Modal(document.getElementById("newMapModal"));
  els.btnConfirmNewMap = document.getElementById("btnConfirmNewMap");
  els.mapTitleModal = new bootstrap.Modal(document.getElementById("mapTitleModal"));
  els.mapTitleInput = document.getElementById("mapTitleInput");
  els.btnSaveMapTitle = document.getElementById("btnSaveMapTitle");
  els.largeAttModal = new bootstrap.Modal(document.getElementById("largeAttModal"));
  els.largeAttName = document.getElementById("largeAttName");
  els.largeAttBody = document.getElementById("largeAttBody");
  els.btnEmbedLarge = document.getElementById("btnEmbedLarge");
  els.btnMetadataOnlyLarge = document.getElementById("btnMetadataOnlyLarge");
}
function bindEvents() {
  els.btnConfirmNewMap.addEventListener("click", doNewMap);
  els.fileInputJson.addEventListener("change", function () {
    if (els.fileInputJson.files && els.fileInputJson.files[0]) openJsonFile(els.fileInputJson.files[0]);
    els.fileInputJson.value = "";
  });
  els.btnNodeModalSave.addEventListener("click", submitNodeModal);
  els.btnConfirmDeleteNode.addEventListener("click", confirmDeleteNode);
  els.btnSaveMapTitle.addEventListener("click", submitMapTitle);
  els.searchInput.addEventListener("input", function () { runSearch(els.searchInput.value); });
  els.btnEmbedLarge.addEventListener("click", function () {
    els.largeAttModal.hide();
    if (pendingAttachment) { pendingAttachment.resolve(true); pendingAttachment = null; }
  });
  els.btnMetadataOnlyLarge.addEventListener("click", function () {
    els.largeAttModal.hide();
    if (pendingAttachment) { pendingAttachment.resolve(false); pendingAttachment = null; }
  });
  document.getElementById("largeAttModal").addEventListener("hidden.bs.modal", function () {
    if (pendingAttachment) { pendingAttachment.resolve(false); pendingAttachment = null; }
  });
  document.addEventListener("click", function (e) {
    if (!els.ctxMenu.contains(e.target)) hideContextMenu();
  });
  window.addEventListener("resize", function () { if (cy) cy.resize(); });
}
function buildLangMenu() {
  els.langMenu.innerHTML = "";
  FT.I18n.availableLanguages().forEach(function (lang) {
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.className = "dropdown-item"; a.href = "#";
    a.textContent = lang.nativeName || lang.name;
    a.addEventListener("click", function (e) { e.preventDefault(); FT.I18n.setLang(lang.code); });
    li.appendChild(a); els.langMenu.appendChild(li);
  });
}
function init() {
  cacheEls();
  FT.I18n.init();
  buildLangMenu();
  FT.I18n.onChange(function () {
    if (selectedNodeId) renderSidebarForNode(findNode(selectedNodeId));
    else if (!selectedEdgeKey) renderSidebarEmpty();
    updateTitleBar();
    if (connectMode) els.connectModeBanner.textContent = FT.I18n.t(connectFirstId ? "connect.bannerSelectSecond" : "connect.bannerSelectFirst");
  });
  initCytoscape();
  bindEvents();
  bindMenuActions();
  bindShortcuts();
  data = emptyMap();
  rebuildGraph(true);
  deselectAll();
  clearDirty();
}
document.addEventListener("DOMContentLoaded", init);
})(window.FT);
