/* public/js/app.js - FIXED
   Depends on: i18n.js + lng/*.js packs (loaded first), Cytoscape, Bootstrap.
   IMPORTANT: the i18n engine lives in public/js/i18n.js only. Do not define FT.I18n here.
   NOTE: connections are always plain lines (no arrows, no direction).
   NOTE: attachments are stored as PATH + METADATA ONLY. No file bytes in JSON.
*/
window.FT = window.FT || {};
(function (FT) {
"use strict";
var cy = null, data = null, dirty = false;
var selectedNodeId = null, selectedEdgeKey = null;
var selectedEdge = null;
var connectMode = false, connectFirstId = null;
var reconnectMode = null;
var dragConnect = null;
var els = {};
var DESC_FILE_MAX_BYTES = 2 * 1024 * 1024;
var MAP_FILE_MAX_BYTES = 10 * 1024 * 1024;
var lastDragTarget = null;

function newId(prefix){
  if(window.crypto && crypto.randomUUID){
    return (prefix||"node")+"-"+crypto.randomUUID();
  }
  return (prefix||"node")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,6);
}
function emptyMap(){ return { version: 1, title: FT.I18n.t("app.untitledMap"), rootId: null, nodes: [], connections: [] }; }
function findNode(id){ return data.nodes.find(function(n){ return n.id===id; }); }
function canonicalKey(a,b){ return a < b ? a+"|"+b : b+"|"+a; } // stable, directionless
function edgeKey(a,b){ return canonicalKey(a,b); } // keep old name but now canonical
function connectionExists(a,b){
  var k = canonicalKey(a,b);
  return data.connections.some(function(c){ return canonicalKey(c.source,c.target)===k; });
}
function markDirty(){ dirty=true; updateTitleBar(); }
function clearDirty(){ dirty=false; updateTitleBar(); }
function updateTitleBar(){
  if(!els.mapTitleDisplay || !data) return;
  els.mapTitleDisplay.textContent = data.title + (dirty ? " *" : "");
}

function viewportCenter(){
  if(!cy) return {x:0,y:0};
  var c = cy.container();
  var w = c ? c.clientWidth : 0;
  var h = c ? c.clientHeight : 0;
  if(w===0 || h===0) return {x:0,y:0};
  var pan = cy.pan();
  var z = cy.zoom()||1;
  if(!isFinite(z) || z===0) z=1;
  return { x: (w/2 - pan.x)/z, y: (h/2 - pan.y)/z };
}

function nodeLabel(n){ return n.title || FT.I18n.t("app.newNodeTitle"); }
function edgeElement(c){
  return { data: { id: canonicalKey(c.source,c.target), source: c.source, target: c.target } };
}
function toElements(){
  var out = data.nodes.map(function(n){
    var x = typeof n.x==="number" && isFinite(n.x) ? n.x : 0;
    var y = typeof n.y==="number" && isFinite(n.y) ? n.y : 0;
    return { data: { id: n.id, label: nodeLabel(n) }, position: {x:x,y:y} };
  });
  data.connections.forEach(function(c){ out.push(edgeElement(c)); });
  return out;
}
function cyStyle(){
  return [
    { selector: "node", style: { "shape": "round-rectangle", "background-color": "#0d6efd", "label": "data(label)", "color": "#ffffff", "text-wrap": "wrap", "text-max-width": "140px", "width": "label", "height": "label", "padding": "12px", "text-valign": "center", "text-halign": "center", "font-size": 12, "border-width": 0 } },
    { selector: "node:selected", style: { "background-color": "#ffc107", "color": "#212529", "border-width": 3, "border-color": "#fd7e14" } },
    { selector: "node.search-highlight", style: { "border-width": 4, "border-color": "#198754" } },
    { selector: "node.connect-candidate", style: { "border-width": 4, "border-color": "#0dcaf0" } },
    { selector: "node.reconnect-target", style: { "border-width": 4, "border-color": "#d63384" } },
    { selector: "node.drag-source", style: { "border-width": 4, "border-color": "#0dcaf0" } },
    { selector: "node.drag-target", style: { "border-width": 4, "border-color": "#198754" } },
    { selector: "edge", style: { "width": 2, "line-color": "#6c757d", "curve-style": "bezier", "target-arrow-shape": "none", "source-arrow-shape": "none" } },
    { selector: "edge:selected", style: { "line-color": "#dc3545", "width": 3 } },
    { selector: "edge.drag-ghost", style: { "line-color": "#0dcaf0", "width": 2, "line-style": "dashed", "events": "no" } }
  ];
}
function initCytoscape(){
  if(!window.cytoscape){
    showAlert("danger","Cytoscape library failed to load. Please check public/js/cytoscape.min.js");
    return;
  }
  cy = window.cytoscape({ container: els.cyContainer, elements: [], style: cyStyle(), wheelSensitivity: 0.25 });

  cy.on("tap", "node", function(evt){ selectNode(evt.target.id()); });
  cy.on("tap", "edge", function(evt){ var e=evt.target; selectEdge(e.data("source"), e.data("target")); });
  cy.on("tap", function(evt){ if(evt.target===cy){ if(connectMode||reconnectMode) return; deselectAll(); } });
  cy.on("dbltap", "node", function(evt){ selectNode(evt.target.id()); centerOn(evt.target.id()); });
  cy.on("dbltap", function(evt){
    if(evt.target===cy){
      var pos=evt.position;
      if(pos) openAddNodeModalAt(pos.x,pos.y);
      else openAddNodeModal();
    }
  });

  cy.on("tapstart", "node", function(evt){
    var oe=evt.originalEvent;
    if(!oe || !(oe.ctrlKey||oe.metaKey)) return;
    if(connectMode||reconnectMode) return;
    evt.target.ungrabify();
    startDragConnect(evt.target.id());
  });

  cy.on("mousemove", function(evt){
    if(!dragConnect) return;
    var ghost=cy.getElementById(dragConnect.ghostId);
    if(ghost && ghost.length) ghost.style("target-position", {x: evt.position.x, y: evt.position.y});
    var hovered = evt.target && evt.target.isNode && evt.target.isNode() ? evt.target : null;
    if(hovered && hovered.id()===dragConnect.sourceId) hovered=null;
    if(hovered && hovered.id()===dragConnect.ghostId) hovered=null;
    if(lastDragTarget !== hovered){
      if(lastDragTarget) lastDragTarget.removeClass("drag-target");
      if(hovered) hovered.addClass("drag-target");
      lastDragTarget = hovered;
    }
  });

  cy.on("tapend", "node", function(evt){
    if(!dragConnect) return;
    finishDragConnect(evt.target.id());
  });
  cy.on("tapend", function(evt){
    if(!dragConnect) return;
    if(evt.target===cy) finishDragConnect(null);
  });

  // Track position changes -> dirty
  cy.on("dragfreeon", "node", function(evt){
    var id=evt.target.id();
    var n=findNode(id);
    if(!n) return;
    var p=evt.target.position();
    n.x=p.x; n.y=p.y;
    markDirty();
  });

  cy.on("cxttap", "node", function(evt){ evt.originalEvent.preventDefault(); selectNode(evt.target.id()); showContextMenu(evt.originalEvent, "node", evt.target.id()); });
  cy.on("cxttap", "edge", function(evt){
    evt.originalEvent.preventDefault();
    var e=evt.target;
    selectEdge(e.data("source"), e.data("target"));
    showContextMenu(evt.originalEvent, "edge", canonicalKey(e.data("source"), e.data("target")));
  });
  cy.on("cxttap", function(evt){
    if(evt.target===cy){
      var oe=evt.originalEvent;
      oe.preventDefault();
      showContextMenu({ clientX: oe.clientX, clientY: oe.clientY, _canvasPos: evt.position }, "canvas");
    }
  });
  els.cyContainer.addEventListener("contextmenu", function(e){ e.preventDefault(); });
}

/* ===== Drag connect ===== */
function startDragConnect(sourceId){
  if(!findNode(sourceId)) return;
  var ghostId="drag-ghost-"+sourceId;
  var old=cy.getElementById(ghostId); if(old && old.length) old.remove();
  cy.add({ data: { id: ghostId, source: sourceId, target: sourceId }, classes: "drag-ghost" });
  dragConnect={ sourceId: sourceId, ghostId: ghostId };
  cy.getElementById(sourceId).addClass("drag-source");
  lastDragTarget=null;
}
function finishDragConnect(targetId){
  if(!dragConnect) return;
  var sourceId=dragConnect.sourceId;
  cancelDragConnect();
  if(!targetId || targetId===sourceId) return;
  addConnection(sourceId,targetId,true);
  selectNode(sourceId);
}
function cancelDragConnect(){
  if(!dragConnect) return;
  var ghost=cy.getElementById(dragConnect.ghostId);
  if(ghost && ghost.length) ghost.remove();
  cy.nodes().removeClass("drag-source drag-target");
  var src=cy.getElementById(dragConnect.sourceId);
  if(src && src.length) src.grabify();
  dragConnect=null;
  lastDragTarget=null;
}

function rebuildGraph(fit){
  cy.elements().remove();
  cy.add(toElements());
  var hasCoords = data.nodes.length && data.nodes.some(function(n){ return typeof n.x==="number" && typeof n.y==="number" && isFinite(n.x) && isFinite(n.y); });
  if(!hasCoords && data.nodes.length) runLayout(false);
  if(fit!==false) cy.fit(undefined,40);
  if(data.rootId && findNode(data.rootId)) selectNode(data.rootId);
}
function runLayout(markAsDirty){
  var name = data.rootId && findNode(data.rootId) ? "breadthfirst" : "cose";
  var opts={ name:name, animate:false, fit:false, padding:30 };
  if(name==="breadthfirst"){ opts.roots="#"+cssEscape(data.rootId); opts.directed=true; }
  var layout=cy.layout(opts); layout.run();
  cy.nodes().forEach(function(ele){
    var n=findNode(ele.id()); if(!n) return;
    var p=ele.position(); n.x=p.x; n.y=p.y;
  });
  if(markAsDirty!==false) markDirty();
}
function cssEscape(s){
  if(window.CSS && CSS.escape) return CSS.escape(String(s));
  return String(s).replace(/([ #.;?%&,+*~':"!^$\[\]()=>|\/@])/g, "\\$1");
}

function deselectAll(){
  selectedNodeId=null; selectedEdgeKey=null; selectedEdge=null;
  if(cy) cy.$(':selected').unselect();
  renderSidebarEmpty();
  updateActionButtons();
}
function selectNode(id){
  if(reconnectMode){ handleReconnectClick(id); return; }
  selectedEdgeKey=null; selectedEdge=null; selectedNodeId=id;
  cy.$(':selected').unselect();
  var ele=cy.getElementById(id); if(ele && ele.length) ele.select();
  renderSidebarForNode(findNode(id));
  updateActionButtons();
  if(connectMode) handleConnectClick(id);
}
function selectEdge(source,target){
  selectedNodeId=null;
  selectedEdgeKey=canonicalKey(source,target);
  selectedEdge={ source: source, target: target };
  cy.$(':selected').unselect();
  var ele=cy.getElementById(selectedEdgeKey); if(ele && ele.length) ele.select();
  renderSidebarForEdge(source,target);
  updateActionButtons();
}
function updateActionButtons(){
  if(els.menuEditNode) els.menuEditNode.disabled=!selectedNodeId;
  if(els.menuDeleteNode) els.menuDeleteNode.disabled=!selectedNodeId;
  if(els.menuDeleteConnection) els.menuDeleteConnection.disabled=!selectedEdgeKey;
}

/* ===== Sidebar ===== */
function renderSidebarEmpty(){
  els.sidebar.innerHTML = '<p class="text-muted" data-i18n="sidebar.emptyState">'+escapeHtml(FT.I18n.t("sidebar.emptyState"))+'</p>';
}
function attachmentSectionHtml(node,kind,labelKey,accept){
  var items=node[kind]||[];
  var listHtml=items.length ? items.map(function(att,idx){
    var pathText=att.path ? escapeHtml(att.path) : "";
    var metaText=[att.name, att.size ? humanSize(att.size) : "", att.type||""].filter(Boolean).join(" · ");
    return '<div class="d-flex align-items-start justify-content-between border rounded p-2 mb-2">'+
             '<div class="small overflow-hidden me-2">'+
               '<div class="text-truncate" title="'+escapeHtml(att.name||"")+'">'+escapeHtml(att.name||"(unnamed)")+'</div>'+
               '<div class="text-truncate text-muted" title="'+pathText+'"><code>'+pathText+'</code></div>'+
               '<div class="text-muted">'+escapeHtml(metaText)+'</div>'+
             '</div>'+
             '<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" data-remove-att="'+escapeHtml(kind)+'" data-idx="'+idx+'">'+escapeHtml(FT.I18n.t("sidebar.remove"))+'</button>'+
           '</div>';
  }).join("") : '<p class="text-muted small">'+escapeHtml(FT.I18n.t("sidebar.noAttachments"))+'</p>';
  var addLabel=FT.I18n.t(labelKey);
  return '<h6 class="mt-3 mb-2">'+escapeHtml(addLabel)+'</h6>'+listHtml+
         '<div class="mb-3"><input type="file" class="form-control form-control-sm" data-add-att="'+escapeHtml(kind)+'" accept="'+escapeHtml(accept)+'" multiple></div>';
}
function renderSidebarForNode(node){
  if(!node){ renderSidebarEmpty(); return; }
  var connections=data.connections.filter(function(c){ return c.source===node.id || c.target===node.id; });
  var connHtml=connections.length ? '<div class="list-group">'+connections.map(function(c){
    var otherId=c.source===node.id ? c.target : c.source;
    var other=findNode(otherId);
    return '<button type="button" class="list-group-item list-group-item-action" data-goto-node="'+escapeHtml(otherId)+'">'+escapeHtml(other ? other.title : otherId)+'</button>';
  }).join("")+"</div>" : '<p class="text-muted small">'+escapeHtml(FT.I18n.t("sidebar.noConnections"))+'</p>';
  els.sidebar.innerHTML =
    '<div class="card mb-3"><div class="card-body"><h5 class="card-title">'+escapeHtml(FT.I18n.t("sidebar.infoTitle"))+'</h5>'+
    '<p class="mb-1"><strong>'+escapeHtml(FT.I18n.t("sidebar.titleLabel"))+'</strong>: '+escapeHtml(node.title||"")+'</p>'+
    '<p class="mb-1"><strong>'+escapeHtml(FT.I18n.t("sidebar.descriptionLabel"))+'</strong>: '+escapeHtml(node.description||"")+'</p>'+
    '<p class="mb-0 text-muted small"><strong>'+escapeHtml(FT.I18n.t("sidebar.idLabel"))+'</strong>: '+escapeHtml(node.id)+'</p></div></div>'+
    '<h6 class="mb-2">'+escapeHtml(FT.I18n.t("sidebar.attachmentsTitle"))+'</h6>'+
    attachmentSectionHtml(node,"images","sidebar.images","image/*")+
    attachmentSectionHtml(node,"audio","sidebar.audio","audio/*")+
    attachmentSectionHtml(node,"video","sidebar.video","video/*")+
    attachmentSectionHtml(node,"files","sidebar.files","*/*")+
    '<h6 class="mb-2">'+escapeHtml(FT.I18n.t("sidebar.connectionsTitle"))+'</h6>'+connHtml;
  bindSidebarEvents(node);
}
function renderSidebarForEdge(source,target){
  var s=findNode(source), t=findNode(target);
  els.sidebar.innerHTML =
    '<div class="card"><div class="card-body">'+
      '<h5 class="card-title">'+escapeHtml(FT.I18n.t("sidebar.edgeSelectedTitle"))+'</h5>'+
      '<p class="mb-1"><strong>'+escapeHtml(FT.I18n.t("sidebar.edgeSource"))+'</strong>: '+escapeHtml(s ? s.title : source)+'</p>'+
      '<p class="mb-1"><strong>'+escapeHtml(FT.I18n.t("sidebar.edgeTarget"))+'</strong>: '+escapeHtml(t ? t.title : target)+'</p>'+
      '<div class="edge-actions d-flex flex-wrap gap-1 mt-3">'+
        '<button type="button" class="btn btn-sm btn-outline-danger" data-edge-action="delete">'+escapeHtml(FT.I18n.t("ctx.deleteEdge"))+'</button>'+
        '<button type="button" class="btn btn-sm btn-outline-info" data-edge-action="reconnectSource">'+escapeHtml(FT.I18n.t("sidebar.reconnectSource"))+'</button>'+
        '<button type="button" class="btn btn-sm btn-outline-info" data-edge-action="reconnectTarget">'+escapeHtml(FT.I18n.t("sidebar.reconnectTarget"))+'</button>'+
      '</div>'+
    '</div></div>';
  els.sidebar.querySelectorAll("[data-edge-action]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var act=btn.getAttribute("data-edge-action");
      if(act==="delete") requestDeleteConnection();
      else if(act==="reconnectSource") startReconnect("source");
      else if(act==="reconnectTarget") startReconnect("target");
    });
  });
}
function bindSidebarEvents(node){
  els.sidebar.querySelectorAll("[data-goto-node]").forEach(function(btn){
    btn.addEventListener("click", function(){ var id=btn.getAttribute("data-goto-node"); selectNode(id); centerOn(id); });
  });
  els.sidebar.querySelectorAll("[data-remove-att]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var kind=btn.getAttribute("data-remove-att"); var idx=parseInt(btn.getAttribute("data-idx"),10);
      if(node[kind] && node[kind][idx]){ node[kind].splice(idx,1); markDirty(); refreshNodeVisual(node); renderSidebarForNode(node); }
    });
  });
  els.sidebar.querySelectorAll("[data-add-att]").forEach(function(input){
    input.addEventListener("change", function(){
      handleAttachmentFiles(node, input.getAttribute("data-add-att"), input.files).then(function(){
        markDirty(); refreshNodeVisual(node); renderSidebarForNode(node);
      });
      input.value="";
    });
  });
}
function centerOn(id){
  var ele=cy.getElementById(id); if(!ele || !ele.length) return;
  cy.animate({ center: { eles: ele }, zoom: Math.max(cy.zoom(),1) }, { duration: 200 });
}
function refreshNodeVisual(node){ var ele=cy.getElementById(node.id); if(ele && ele.length) ele.data("label", nodeLabel(node)); }
function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
function humanSize(bytes){ if(!bytes) return ""; if(bytes<1024) return bytes+" B"; if(bytes<1024*1024) return (bytes/1024).toFixed(1)+" KB"; return (bytes/(1024*1024)).toFixed(1)+" MB"; }

/* ===== Attachments ===== */
function handleAttachmentFiles(node,kind,fileList){
  var files=Array.prototype.slice.call(fileList||[]);
  if(files.length>50){ showAlert("warning","Too many files selected (max 50)"); files=files.slice(0,50); }
  return files.reduce(function(chain,file){
    return chain.then(function(){
      return new Promise(function(resolve){
        var entered=window.prompt(FT.I18n.t("prompt.attachmentPath", {name: file.name}), "");
        if(entered==null){ resolve(); return; }
        var trimmed=entered.trim();
        if(!trimmed){ resolve(); return; }
        if(trimmed.length>500){ showAlert("warning","Path too long (max 500 chars)"); resolve(); return; }
        node[kind].push({ name: file.name, type: file.type||"", size: file.size||0, path: trimmed });
        resolve();
      });
    });
  }, Promise.resolve());
}

/* ===== Node CRUD ===== */
var nodeModalMode="add", nodeModalTargetId=null, pendingAddPosition=null;
function openAddNodeModal(){ pendingAddPosition=null; _openAddNodeModal(); }
function openAddNodeModalAt(x,y){ pendingAddPosition={x:x,y:y}; _openAddNodeModal(); }
function _openAddNodeModal(){
  nodeModalMode="add"; nodeModalTargetId=null;
  els.nodeModalLabel.textContent=FT.I18n.t("modal.addNodeTitle");
  els.nodeTitleInput.value=""; els.nodeDescInput.value="";
  if(els.descFileStatus) els.descFileStatus.textContent="";
  els.connectToSelectedWrap.classList.toggle("d-none", !selectedNodeId);
  els.connectToSelectedInput.checked=!!selectedNodeId;
  els.nodeModal.show();
  setTimeout(function(){ els.nodeTitleInput.focus(); },200);
}
function openEditNodeModal(){
  if(!selectedNodeId) return;
  var n=findNode(selectedNodeId); if(!n) return;
  nodeModalMode="edit"; nodeModalTargetId=n.id;
  els.nodeModalLabel.textContent=FT.I18n.t("modal.editNodeTitle");
  els.nodeTitleInput.value=n.title||""; els.nodeDescInput.value=n.description||"";
  if(els.descFileStatus) els.descFileStatus.textContent="";
  els.connectToSelectedWrap.classList.add("d-none");
  els.nodeModal.show();
  setTimeout(function(){ els.nodeTitleInput.focus(); },200);
}
function readFileIntoDescription(file){
  if(!file) return;
  if(file.size>DESC_FILE_MAX_BYTES){
    if(els.descFileStatus) els.descFileStatus.textContent=FT.I18n.t("modal.fileTooLarge");
    return;
  }
  var reader=new FileReader();
  if(els.descFileStatus) els.descFileStatus.textContent=FT.I18n.t("modal.readingFile");
  reader.onload=function(){
    els.nodeDescInput.value=typeof reader.result==="string" ? reader.result : "";
    if(els.descFileStatus) els.descFileStatus.textContent=FT.I18n.t("modal.fileLoaded", {name: file.name});
  };
  reader.onerror=function(){
    if(els.descFileStatus) els.descFileStatus.textContent=FT.I18n.t("modal.fileReadError");
  };
  reader.readAsText(file);
}
function submitNodeModal(){
  var title=els.nodeTitleInput.value.trim() || FT.I18n.t("app.newNodeTitle");
  var desc=els.nodeDescInput.value.trim();
  if(title.length>200){ showAlert("warning","Title too long (max 200 chars)"); return; }
  if(desc.length>10000){ showAlert("warning","Description too long (max 10000 chars)"); return; }
  if(nodeModalMode==="edit" && nodeModalTargetId){
    var n=findNode(nodeModalTargetId); n.title=title; n.description=desc;
    refreshNodeVisual(n);
    if(selectedNodeId===n.id) renderSidebarForNode(n);
    markDirty();
  } else {
    var id=newId("node"); var prevSelected=selectedNodeId;
    var pos=pendingAddPosition || {x:0,y:0};
    if(!pendingAddPosition){
      var ele=prevSelected ? cy.getElementById(prevSelected) : null;
      if(ele && ele.length){
        var p=ele.position();
        pos={x:p.x+120,y:p.y+60};
      } else {
        pos=viewportCenter();
      }
    }
    var newNode={ id:id, title:title, description:desc, x:pos.x, y:pos.y, images:[], audio:[], video:[], files:[] };
    data.nodes.push(newNode);
    if(!data.rootId) data.rootId=id;
    cy.add({ data: { id:id, label: nodeLabel(newNode) }, position: pos });
    cy.getElementById(id).grabify();
    if(prevSelected && !els.connectToSelectedWrap.classList.contains("d-none") && els.connectToSelectedInput.checked) addConnection(prevSelected,id);
    markDirty(); selectNode(id);
  }
  pendingAddPosition=null;
  els.nodeModal.hide();
}
function requestDeleteNode(){ if(!selectedNodeId) return; els.deleteNodeModal.show(); }
function confirmDeleteNode(){
  var id=selectedNodeId; if(!id){ els.deleteNodeModal.hide(); return; }
  cancelReconnect();
  data.nodes=data.nodes.filter(function(n){ return n.id!==id; });
  data.connections=data.connections.filter(function(c){ return c.source!==id && c.target!==id; });
  if(data.rootId===id) data.rootId=data.nodes.length ? data.nodes[0].id : null;
  var el=cy.getElementById(id);
  if(el && el.length){ el.connectedEdges().remove(); el.remove(); }
  deselectAll(); markDirty(); els.deleteNodeModal.hide();
}

/* ===== Connect mode ===== */
function toggleConnectMode(){
  cancelReconnect();
  connectMode=!connectMode; connectFirstId=null;
  cy.nodes().removeClass("connect-candidate");
  els.connectModeBanner.classList.toggle("d-none", !connectMode);
  els.connectModeBanner.textContent=FT.I18n.t("connect.bannerSelectFirst");
}
function cancelConnectMode(){
  connectMode=false; connectFirstId=null;
  cy.nodes().removeClass("connect-candidate");
  if(!reconnectMode) els.connectModeBanner.classList.add("d-none");
}
function handleConnectClick(id){
  if(!connectFirstId){
    connectFirstId=id;
    cy.getElementById(id).addClass("connect-candidate");
    els.connectModeBanner.textContent=FT.I18n.t("connect.bannerSelectSecond");
    return;
  }
  if(connectFirstId===id) return;
  addConnection(connectFirstId,id,true);
  cy.nodes().removeClass("connect-candidate");
  connectFirstId=null;
  els.connectModeBanner.textContent=FT.I18n.t("connect.bannerSelectFirst");
}
function addConnection(source,target,showWarnings){
  if(source===target){ if(showWarnings) showAlert("warning", FT.I18n.t("connect.selfNotAllowed")); return false; }
  if(connectionExists(source,target)){ if(showWarnings) showAlert("warning", FT.I18n.t("connect.duplicate")); return false; }
  var conn={ source: source, target: target };
  data.connections.push(conn);
  cy.add(edgeElement(conn));
  markDirty(); return true;
}
function requestDeleteConnection(){
  if(!selectedEdgeKey) return;
  data.connections=data.connections.filter(function(c){ return canonicalKey(c.source,c.target)!==selectedEdgeKey; });
  var el=cy.getElementById(selectedEdgeKey);
  if(el && el.length) el.remove();
  selectedEdgeKey=null; selectedEdge=null;
  renderSidebarEmpty(); updateActionButtons(); markDirty();
}

/* ===== Re-connect ===== */
function startReconnect(end){
  if(!selectedEdgeKey || !selectedEdge) return;
  cancelConnectMode();
  reconnectMode={ edgeKey: selectedEdgeKey, end: end };
  cy.nodes().addClass("reconnect-target");
  els.connectModeBanner.classList.remove("d-none");
  els.connectModeBanner.textContent=FT.I18n.t(end==="source" ? "connect.reconnectSource" : "connect.reconnectTarget");
}
function handleReconnectClick(newNodeId){
  if(!reconnectMode) return;
  var otherEnd = reconnectMode.end==="source" ? selectedEdge.target : selectedEdge.source;
  if(newNodeId===otherEnd){ showAlert("warning", FT.I18n.t("connect.reconnectSameNode")); return; }
  finishReconnect(newNodeId);
}
function finishReconnect(newNodeId){
  if(!reconnectMode || !selectedEdge) return;
  var oldKey=reconnectMode.edgeKey;
  var newSource = reconnectMode.end==="source" ? newNodeId : selectedEdge.source;
  var newTarget = reconnectMode.end==="target" ? newNodeId : selectedEdge.target;
  if(newSource===newTarget){ showAlert("warning", FT.I18n.t("connect.selfNotAllowed")); cancelReconnect(); return; }
  if(connectionExists(newSource,newTarget) && canonicalKey(newSource,newTarget)!==oldKey){
    showAlert("warning", FT.I18n.t("connect.duplicate")); cancelReconnect(); return;
  }
  var oldEdge=cy.getElementById(oldKey);
  if(oldEdge && oldEdge.length) oldEdge.remove();
  data.connections=data.connections.filter(function(c){ return canonicalKey(c.source,c.target)!==oldKey; });
  data.connections.push({ source: newSource, target: newTarget });
  cy.add(edgeElement({source:newSource,target:newTarget}));
  markDirty();
  cancelReconnect();
  selectEdge(newSource,newTarget);
}
function cancelReconnect(){
  if(!reconnectMode) return;
  reconnectMode=null;
  cy.nodes().removeClass("reconnect-target");
  els.connectModeBanner.classList.add("d-none");
  if(!connectMode) els.connectModeBanner.classList.add("d-none");
}

/* ===== Context menu ===== */
function hideContextMenu(){ els.ctxMenu.classList.add("d-none"); els.ctxMenu.innerHTML=""; }
function showContextMenu(evt,kind,target){
  hideContextMenu();
  var items=[];
  if(kind==="node"){
    items.push({label:FT.I18n.t("ctx.editNode"), action:"editNode", shortcut:"E"});
    items.push({label:FT.I18n.t("ctx.deleteNode"), action:"deleteNode", shortcut:"Del", danger:true});
    items.push({divider:true});
    items.push({label:FT.I18n.t("ctx.connectFrom"), action:"connectFromHere"});
    items.push({label:FT.I18n.t("ctx.centerNode"), action:"centerNode"});
  } else if(kind==="edge"){
    items.push({label:FT.I18n.t("ctx.deleteEdge"), action:"deleteEdge", shortcut:"Del", danger:true});
    items.push({divider:true});
    items.push({label:FT.I18n.t("ctx.reconnectSource"), action:"reconnectSource"});
    items.push({label:FT.I18n.t("ctx.reconnectTarget"), action:"reconnectTarget"});
  } else {
    items.push({label:FT.I18n.t("ctx.addNode"), action:"addNodeHere", shortcut:"N"});
    items.push({divider:true});
    items.push({label:FT.I18n.t("ctx.fitMap"), action:"fitMap", shortcut:"F"});
    items.push({label:FT.I18n.t("ctx.autoLayout"), action:"autoLayout", shortcut:"L"});
    items.push({label:FT.I18n.t("ctx.focusSearch"), action:"focusSearch"});
    items.push({divider:true});
    items.push({label:FT.I18n.t("ctx.editMapTitle"), action:"editMapTitle"});
    items.push({label:FT.I18n.t("ctx.saveMap"), action:"saveMap"});
    items.push({label:FT.I18n.t("ctx.openMap"), action:"openMap"});
    items.push({label:FT.I18n.t("ctx.newMap"), action:"newMap", danger:true});
    items.push({divider:true});
    items.push({label:FT.I18n.t("ctx.showHelp"), action:"showHelp"});
  }
  items.forEach(function(it){
    if(it.divider){ var d=document.createElement("li"); d.innerHTML='<hr class="dropdown-divider">'; els.ctxMenu.appendChild(d); return; }
    var li=document.createElement("li");
    var btn=document.createElement("button");
    btn.type="button"; btn.className="dropdown-item"+(it.danger ? " text-danger" : "");
    var spanLabel=document.createElement("span"); spanLabel.textContent=it.label;
    btn.appendChild(spanLabel);
    if(it.shortcut){
      var spanShort=document.createElement("span"); spanShort.className="shortcut"; spanShort.textContent=it.shortcut;
      btn.appendChild(spanShort);
    }
    btn.addEventListener("click", function(){
      hideContextMenu();
      if(it.action==="editNode") openEditNodeModal();
      else if(it.action==="deleteNode") requestDeleteNode();
      else if(it.action==="deleteEdge") requestDeleteConnection();
      else if(it.action==="connectFromHere"){ if(!connectMode) toggleConnectMode(); handleConnectClick(target); }
      else if(it.action==="centerNode"){ selectNode(target); centerOn(target); }
      else if(it.action==="reconnectSource") startReconnect("source");
      else if(it.action==="reconnectTarget") startReconnect("target");
      else if(it.action==="addNodeHere"){ if(evt._canvasPos) openAddNodeModalAt(evt._canvasPos.x, evt._canvasPos.y); else openAddNodeModal(); }
      else if(it.action==="fitMap") cy.fit(undefined,40);
      else if(it.action==="autoLayout"){ runLayout(true); cy.fit(undefined,40); }
      else if(it.action==="focusSearch") els.searchInput.focus();
      else if(it.action==="editMapTitle") openMapTitleEdit();
      else if(it.action==="saveMap") saveJson();
      else if(it.action==="openMap") els.fileInputJson.click();
      else if(it.action==="newMap") requestNewMap();
      else if(it.action==="showHelp") showHelp();
    });
    li.appendChild(btn); els.ctxMenu.appendChild(li);
  });
  var x=evt.clientX||0, y=evt.clientY||0;
  els.ctxMenu.style.left=x+"px"; els.ctxMenu.style.top=y+"px";
  els.ctxMenu.classList.remove("d-none");
  requestAnimationFrame(function(){
    var r=els.ctxMenu.getBoundingClientRect();
    if(r.right>window.innerWidth) els.ctxMenu.style.left=Math.max(0,window.innerWidth - r.width -4)+"px";
    if(r.bottom>window.innerHeight) els.ctxMenu.style.top=Math.max(0,window.innerHeight - r.height -4)+"px";
  });
}

/* ===== New / Open / Save ===== */
function requestNewMap(){ if(dirty){ els.newMapModal.show(); return; } doNewMap(); }
function doNewMap(){
  data=emptyMap(); cancelConnectMode(); cancelReconnect(); cancelDragConnect(); deselectAll(); rebuildGraph(true); clearDirty();
  els.newMapModal.hide(); showAlert("success", FT.I18n.t("alert.mapCreated"));
}
function openJsonFile(file){
  if(!file) return;
  if(file.size>MAP_FILE_MAX_BYTES){ showAlert("danger","File too large (max 10MB)"); return; }
  var reader=new FileReader();
  reader.onload=function(){
    var parsed;
    try{ parsed=JSON.parse(reader.result); } catch(e){ showAlert("danger", FT.I18n.t("alert.invalidJson")); return; }
    var result=normalizeMap(parsed);
    if(!result.ok){ showAlert("danger", FT.I18n.t("alert.invalidStructure")); return; }
    data=result.map; cancelConnectMode(); cancelReconnect(); cancelDragConnect(); rebuildGraph(true); clearDirty();
    result.notices.forEach(function(msg){ showAlert("warning", msg); });
    showAlert("success", FT.I18n.t("alert.mapOpened"));
  };
  reader.onerror=function(){ showAlert("danger", FT.I18n.t("alert.invalidJson")); };
  reader.readAsText(file);
}
function sanitizeAttachments(list){
  if(!Array.isArray(list)) return [];
  return list.map(function(a){
    if(!a || typeof a!=="object") return null;
    var name=typeof a.name==="string" ? a.name.slice(0,200) : "";
    var type=typeof a.type==="string" ? a.type.slice(0,100) : "";
    var size=typeof a.size==="number" && isFinite(a.size) ? a.size : 0;
    var path=typeof a.path==="string" ? a.path.trim().slice(0,500) : "";
    if(!name && !path) return null;
    if(!path) return null; // path is mandatory
    return { name:name, type:type, size:size, path:path };
  }).filter(Boolean);
}
function normalizeMap(raw){
  var notices=[];
  if(!raw || typeof raw!=="object" || !Array.isArray(raw.nodes)) return {ok:false};
  var map={ version: raw.version||1, title: typeof raw.title==="string" && raw.title.trim() ? raw.title.trim().slice(0,200) : FT.I18n.t("app.untitledMap"), rootId: raw.rootId||null, nodes:[], connections:[] };
  var seenIds={}, missingIdCount=0, dupIdCount=0;
  (raw.nodes||[]).forEach(function(n){
    if(!n || typeof n!=="object") return;
    var id=n.id;
    if(!id){ id=newId("node"); missingIdCount++; }
    if(seenIds[id]){ id=newId("node"); dupIdCount++; }
    seenIds[id]=true;
    map.nodes.push({
      id:id,
      title: typeof n.title==="string" ? n.title.slice(0,200) : "",
      description: typeof n.description==="string" ? n.description.slice(0,10000) : "",
      x: typeof n.x==="number" && isFinite(n.x) ? n.x : 0,
      y: typeof n.y==="number" && isFinite(n.y) ? n.y : 0,
      images: sanitizeAttachments(n.images),
      audio: sanitizeAttachments(n.audio),
      video: sanitizeAttachments(n.video),
      files: sanitizeAttachments(n.files)
    });
  });
  var validIds={}; map.nodes.forEach(function(n){ validIds[n.id]=true; });
  var invalidConnCount=0, seenConn={};
  (raw.connections||[]).forEach(function(c){
    if(!c || !validIds[c.source] || !validIds[c.target]){ invalidConnCount++; return; }
    var key=canonicalKey(c.source,c.target);
    if(seenConn[key]) return;
    seenConn[key]=true;
    map.connections.push({ source: c.source, target: c.target });
  });
  if(!map.rootId || !validIds[map.rootId]) map.rootId=map.nodes.length ? map.nodes[0].id : null;
  if(missingIdCount) notices.push(FT.I18n.t("alert.missingIdsGenerated", {count: missingIdCount}));
  if(dupIdCount) notices.push(FT.I18n.t("alert.duplicateIdsFixed", {count: dupIdCount}));
  if(invalidConnCount) notices.push(FT.I18n.t("alert.invalidConnectionsRemoved", {count: invalidConnCount}));
  return {ok:true, map:map, notices:notices};
}
function syncPositionsFromCy(){
  cy.nodes().forEach(function(ele){ var n=findNode(ele.id()); if(!n) return; var p=ele.position(); n.x=p.x; n.y=p.y; });
}
function saveJson(){
  if(!cy){ showAlert("danger","Graph not initialized"); return; }
  syncPositionsFromCy();
  var json=JSON.stringify(data,null,2);
  var blob=new Blob([json], {type:"application/json"});
  var url=URL.createObjectURL(blob);
  var rawTitle=(data.title||"mind-map").trim();
  var base=rawTitle.replace(/[^a-z0-9\-_]+/gi,"-").replace(/^-+|-+$/g,"").replace(/-+/g,"-").slice(0,100) || "mind-map";
  var filename=base+".json";
  var a=document.createElement("a"); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url); clearDirty();
  showAlert("success", FT.I18n.t("alert.savedOk", {filename: filename}));
}

/* ===== Search ===== */
function runSearch(term){
  if(!cy) return;
  cy.nodes().removeClass("search-highlight");
  term=(term||"").trim().toLowerCase();
  els.searchResults.innerHTML=""; els.searchResults.classList.add("d-none");
  if(!term) return;
  var matches=data.nodes.filter(function(n){ return (n.title||"").toLowerCase().indexOf(term)!==-1 || (n.description||"").toLowerCase().indexOf(term)!==-1; });
  matches.forEach(function(n){ var ele=cy.getElementById(n.id); if(ele && ele.length) ele.addClass("search-highlight"); });
  if(!matches.length) return;
  els.searchResults.classList.remove("d-none");
  matches.slice(0,20).forEach(function(n){
    var item=document.createElement("button"); item.type="button"; item.className="list-group-item list-group-item-action";
    item.textContent=n.title||n.id;
    item.addEventListener("click", function(){ selectNode(n.id); centerOn(n.id); els.searchResults.classList.add("d-none"); els.searchInput.value=""; cy.nodes().removeClass("search-highlight"); });
    els.searchResults.appendChild(item);
  });
}

/* ===== Alerts ===== */
function showAlert(type,message){
  if(!message) return;
  var div=document.createElement("div");
  div.className="alert alert-"+type+" alert-dismissible fade show shadow-sm";
  div.setAttribute("role","alert"); div.textContent=message;
  var btn=document.createElement("button"); btn.type="button"; btn.className="btn-close"; btn.setAttribute("data-bs-dismiss","alert");
  div.appendChild(btn); els.alertContainer.appendChild(div);
  setTimeout(function(){ if(div.parentNode){ try{ bootstrap.Alert.getOrCreateInstance(div).close(); } catch(e){ div.remove(); } } },6000);
}

/* ===== Map title ===== */
function openMapTitleEdit(){ els.mapTitleInput.value=data.title||""; els.mapTitleModal.show(); setTimeout(function(){ els.mapTitleInput.select(); },200); }
function submitMapTitle(){ var t=els.mapTitleInput.value.trim().slice(0,200); if(t){ data.title=t; markDirty(); updateTitleBar(); } els.mapTitleModal.hide(); }

/* ===== Help ===== */
function showHelp(){ els.helpModal.show(); }

/* ===== Keyboard shortcuts ===== */
function isTypingTarget(el){ return el && (el.tagName==="INPUT" || el.tagName==="TEXTAREA" || el.isContentEditable); }
function bindShortcuts(){
  document.addEventListener("keydown", function(e){
    if(e.key==="Escape"){
      if(dragConnect){ cancelDragConnect(); return; }
      if(reconnectMode){ cancelReconnect(); return; }
      if(connectMode){ cancelConnectMode(); return; }
      hideContextMenu();
    }
    var typing=isTypingTarget(document.activeElement);
    if(typing && e.key!=="Escape") return;
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="s"){ e.preventDefault(); saveJson(); return; }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="o"){ e.preventDefault(); els.fileInputJson.click(); return; }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="n"){ e.preventDefault(); requestNewMap(); return; }
    if(e.key==="Delete" || e.key==="Backspace"){
      if(selectedNodeId){ e.preventDefault(); requestDeleteNode(); return; }
      if(selectedEdgeKey){ e.preventDefault(); requestDeleteConnection(); return; }
    }
    if(typing) return;
    var k=e.key;
    if(k==="+"){ cy.zoom(cy.zoom()*1.2); return; }
    if(k==="-" || k==="−"){ cy.zoom(cy.zoom()/1.2); return; }
    var lower=k.toLowerCase();
    if(lower==="f"){ cy.fit(undefined,40); return; }
    if(lower==="n"){ openAddNodeModal(); return; }
    if(lower==="e"){ if(selectedNodeId) openEditNodeModal(); return; }
    if(lower==="c"){ toggleConnectMode(); return; }
    if(lower==="l"){ runLayout(true); cy.fit(undefined,40); return; }
    if(lower==="t"){ openMapTitleEdit(); return; }
    if(k==="/"){ e.preventDefault(); els.searchInput.focus(); return; }
    if(k==="?" || k==="F1"){ e.preventDefault(); showHelp(); return; }
  });
}

/* ===== Menu actions ===== */
function bindMenuActions(){
  document.querySelectorAll("[data-action]").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.preventDefault();
      if(btn.disabled) return;
      var action=btn.getAttribute("data-action");
      switch(action){
        case "newMap": requestNewMap(); break;
        case "openJson": els.fileInputJson.click(); break;
        case "saveJson": saveJson(); break;
        case "editMapTitle": openMapTitleEdit(); break;
        case "addNode": openAddNodeModal(); break;
        case "editNode": openEditNodeModal(); break;
        case "deleteNode": requestDeleteNode(); break;
        case "connectNodes": toggleConnectMode(); break;
        case "deleteConnection": requestDeleteConnection(); break;
        case "fitMap": cy.fit(undefined,40); break;
        case "zoomIn": cy.zoom(cy.zoom()*1.2); break;
        case "zoomOut": cy.zoom(cy.zoom()/1.2); break;
        case "autoLayout": runLayout(true); cy.fit(undefined,40); break;
        case "showHelp": showHelp(); break;
      }
    });
  });
}

/* ===== Init ===== */
function cacheEls(){
  els.cyContainer=document.getElementById("cy");
  els.mapTitleDisplay=document.getElementById("mapTitleDisplay");
  els.sidebar=document.getElementById("sidebar");
  els.alertContainer=document.getElementById("alertContainer");
  els.connectModeBanner=document.getElementById("connectModeBanner");
  els.searchInput=document.getElementById("searchInput");
  els.searchResults=document.getElementById("searchResults");
  els.fileInputJson=document.getElementById("fileInputJson");
  els.langMenu=document.getElementById("langMenu");
  els.ctxMenu=document.getElementById("ctxMenu");
  els.menuEditNode=document.getElementById("menuEditNode");
  els.menuDeleteNode=document.getElementById("menuDeleteNode");
  els.menuDeleteConnection=document.getElementById("menuDeleteConnection");
  els.nodeModalLabel=document.getElementById("nodeModalLabel");
  els.nodeTitleInput=document.getElementById("nodeTitleInput");
  els.nodeDescInput=document.getElementById("nodeDescInput");
  els.connectToSelectedWrap=document.getElementById("connectToSelectedWrap");
  els.connectToSelectedInput=document.getElementById("connectToSelectedInput");
  els.btnNodeModalSave=document.getElementById("btnNodeModalSave");
  els.btnLoadDescFromFile=document.getElementById("btnLoadDescFromFile");
  els.descFileStatus=document.getElementById("descFileStatus");
  els.fileInputDesc=document.getElementById("fileInputDesc");
  els.nodeModal=new bootstrap.Modal(document.getElementById("nodeModal"));
  els.deleteNodeModal=new bootstrap.Modal(document.getElementById("deleteNodeModal"));
  els.btnConfirmDeleteNode=document.getElementById("btnConfirmDeleteNode");
  els.newMapModal=new bootstrap.Modal(document.getElementById("newMapModal"));
  els.btnConfirmNewMap=document.getElementById("btnConfirmNewMap");
  els.mapTitleModal=new bootstrap.Modal(document.getElementById("mapTitleModal"));
  els.mapTitleInput=document.getElementById("mapTitleInput");
  els.btnSaveMapTitle=document.getElementById("btnSaveMapTitle");
  els.helpModal=new bootstrap.Modal(document.getElementById("helpModal"));
}
function bindEvents(){
  els.btnConfirmNewMap.addEventListener("click", doNewMap);
  els.fileInputJson.addEventListener("change", function(){
    var f=els.fileInputJson.files && els.fileInputJson.files[0];
    if(f) openJsonFile(f);
    els.fileInputJson.value="";
  });
  els.btnNodeModalSave.addEventListener("click", submitNodeModal);
  els.btnLoadDescFromFile.addEventListener("click", function(){ els.fileInputDesc.click(); });
  els.fileInputDesc.addEventListener("change", function(){
    var f=els.fileInputDesc.files && els.fileInputDesc.files[0];
    if(f) readFileIntoDescription(f);
    els.fileInputDesc.value="";
  });
  els.btnConfirmDeleteNode.addEventListener("click", confirmDeleteNode);
  els.btnSaveMapTitle.addEventListener("click", submitMapTitle);
  els.mapTitleInput.addEventListener("keydown", function(e){ if(e.key==="Enter"){ e.preventDefault(); submitMapTitle(); } });
  els.nodeTitleInput.addEventListener("keydown", function(e){ if(e.key==="Enter" && (e.ctrlKey||e.metaKey)){ e.preventDefault(); submitNodeModal(); } });
  els.searchInput.addEventListener("input", function(){ runSearch(els.searchInput.value); });
  document.addEventListener("click", function(e){
    if(!els.ctxMenu.contains(e.target)) hideContextMenu();
    if(!els.searchResults.contains(e.target) && e.target!==els.searchInput) { els.searchResults.classList.add("d-none"); }
  });
  window.addEventListener("resize", function(){ if(cy) cy.resize(); });
  window.addEventListener("blur", function(){ cancelDragConnect(); });
  window.addEventListener("beforeunload", function(e){
    if(!dirty) return;
    e.preventDefault();
    e.returnValue="";
    return "";
  });
}
function buildLangMenu(){
  els.langMenu.innerHTML="";
  FT.I18n.availableLanguages().forEach(function(lang){
    var li=document.createElement("li");
    var a=document.createElement("a");
    a.className="dropdown-item"; a.href="#";
    a.textContent=lang.nativeName || lang.name;
    a.addEventListener("click", function(e){ e.preventDefault(); FT.I18n.setLang(lang.code); });
    li.appendChild(a); els.langMenu.appendChild(li);
  });
}
function init(){
  cacheEls();
  FT.I18n.init();
  buildLangMenu();
  FT.I18n.onChange(function(){
    if(selectedNodeId) renderSidebarForNode(findNode(selectedNodeId));
    else if(selectedEdge) renderSidebarForEdge(selectedEdge.source, selectedEdge.target);
    else renderSidebarEmpty();
    updateTitleBar();
    if(reconnectMode) els.connectModeBanner.textContent=FT.I18n.t(reconnectMode.end==="source" ? "connect.reconnectSource" : "connect.reconnectTarget");
    else if(connectMode) els.connectModeBanner.textContent=FT.I18n.t(connectFirstId ? "connect.bannerSelectSecond" : "connect.bannerSelectFirst");
  });
  initCytoscape();
  bindEvents();
  bindMenuActions();
  bindShortcuts();
  data=emptyMap();
  rebuildGraph(true);
  deselectAll();
  clearDirty();
}
document.addEventListener("DOMContentLoaded", init);
})(window.FT);
