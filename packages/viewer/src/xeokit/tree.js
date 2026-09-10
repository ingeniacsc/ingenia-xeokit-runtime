// SPDX-License-Identifier: AGPL-3.0-only

import { createTreeSearchPlan, normalizeTreeSearchText } from "./tree-search.js";
import { populateModelTree, resolveModelStoreys } from "./tree-hierarchy.js";
import {
  bindModelTreeKeyboardNavigation, decorateModelTreeBody,
  resolveModelTreeCopy, resolveSingleModelTreeSelection,
} from "./tree-interaction.js";
import { makeViewportPanelDraggable } from "./floating-panel.js";
export const MODEL_TREE_TABS = Object.freeze([
  { id: "models", label: "Models", hierarchy: "containment" },
  { id: "containment", label: "Objects", hierarchy: "containment" },
  { id: "types", label: "Classes", hierarchy: "types" },
  { id: "storeys", label: "Storeys", hierarchy: "storeys" },
]);
function collectNodeObjectIds(viewer, plugin, node) {
  const objectIds = [];
  const append = (objectId) => {
    if (objectId && viewer?.scene?.objects?.[objectId]) objectIds.push(objectId);
  };
  const walk = plugin?.withNodeTree || plugin?._withNodeTree;
  walk?.call(plugin, node, (child) => append(child?.objectId));
  if (!objectIds.length && node?.objectId) {
    (viewer?.metaScene?.getObjectIDsInSubtree?.(node.objectId) || []).forEach(append);
    append(node.objectId);
  }
  return Array.from(new Set(objectIds));
}
function destroyPlugin(plugin) {
  try {
    if (plugin?._onObjectXrayed) plugin?._viewer?.scene?.off?.(plugin._onObjectXrayed);
    plugin?.destroy?.();
  } catch {
    // The viewer may already be tearing down.
  }
}

function focusObjectIds(viewer, objectIds, onSelect) {
  const ids = Array.from(new Set(objectIds)).filter((objectId) => viewer?.scene?.objects?.[objectId]);
  if (!ids.length) return;
  viewer.scene.setObjectsVisible?.(viewer.scene.objectIds, false);
  viewer.scene.setObjectsVisible?.(ids, true);
  const aabb = viewer.scene.getAABB?.(ids);
  if (aabb) viewer.cameraFlight?.flyTo?.({ aabb, fit: true, duration: 0.6 });
  onSelect?.(resolveSingleModelTreeSelection(ids));
}

function setStoreyBranchExpanded(toggle, content, expanded) {
  content.hidden = !expanded;
  toggle.textContent = expanded ? "−" : "+";
  toggle.setAttribute("aria-expanded", String(expanded));
}

function collectStoreyTypeGroups(viewer, storey) {
  const groups = new Map();
  storey.objectIds.forEach((storeyId) => {
    (viewer?.metaScene?.getObjectIDsInSubtree?.(storeyId) || []).forEach((objectId) => {
      if (!viewer?.scene?.objects?.[objectId]) return;
      const type = String(viewer?.metaScene?.metaObjects?.[objectId]?.type || "IfcElement");
      const group = groups.get(type) || new Set();
      group.add(objectId);
      groups.set(type, group);
    });
  });
  return Array.from(groups, ([label, objectIds]) => ({ label, objectIds: Array.from(objectIds) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function renderStoreyTree(body, storeys, { emptyMessage, onSelect, viewer }) {
  body.replaceChildren();
  if (!storeys.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "ingenia-model-tree-search-status";
    emptyState.dataset.treeEmpty = "true";
    emptyState.setAttribute("role", "status");
    emptyState.textContent = emptyMessage;
    body.appendChild(emptyState);
    return;
  }
  const tree = document.createElement("ul");
  const groups = new Map();
  storeys.forEach((storey) => {
    let group = groups.get(storey.modelId);
    if (!group) {
      const groupItem = document.createElement("li");
      groupItem.className = "ingenia-model-tree-storey-model";
      groupItem.dataset.modelTreeStoreyModel = "true";
      const groupHeader = document.createElement("div");
      groupHeader.className = "ingenia-model-tree-storey-row";
      const groupToggle = document.createElement("button");
      groupToggle.type = "button";
      groupToggle.className = "ingenia-model-tree-disclosure";
      groupToggle.title = `Thu gọn ${storey.displayName}`;
      groupToggle.setAttribute("aria-label", groupToggle.title);
      const groupLabel = document.createElement("span");
      groupLabel.textContent = storey.displayName;
      const groupList = document.createElement("ul");
      setStoreyBranchExpanded(groupToggle, groupList, true);
      groupToggle.addEventListener("click", () => {
        const expanded = groupToggle.getAttribute("aria-expanded") !== "true";
        setStoreyBranchExpanded(groupToggle, groupList, expanded);
        groupToggle.title = `${expanded ? "Thu gọn" : "Mở"} ${storey.displayName}`;
        groupToggle.setAttribute("aria-label", groupToggle.title);
      });
      groupHeader.append(groupToggle, groupLabel);
      groupItem.append(groupHeader, groupList);
      tree.appendChild(groupItem);
      group = groupList;
      groups.set(storey.modelId, group);
    }
    const item = document.createElement("li");
    item.dataset.modelTreeStorey = "true";
    item.dataset.modelTreeStoreySearch = `${storey.displayName} ${storey.label}`;
    const row = document.createElement("div");
    row.className = "ingenia-model-tree-storey-row";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ingenia-model-tree-disclosure";
    toggle.title = `Mở ${storey.label}`;
    toggle.setAttribute("aria-label", toggle.title);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ingenia-model-tree-storey-button";
    button.textContent = storey.label;
    button.title = storey.label;
    button.setAttribute("aria-label", storey.label);
    button.addEventListener("click", () => {
      focusObjectIds(viewer, storey.objectIds.flatMap((objectId) => (
        collectNodeObjectIds(viewer, null, { objectId })
      )), onSelect);
    });
    const typeList = document.createElement("ul");
    let typesRendered = false;
    setStoreyBranchExpanded(toggle, typeList, false);
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      if (expanded && !typesRendered) {
        collectStoreyTypeGroups(viewer, storey).forEach(({ label, objectIds }) => {
          const typeItem = document.createElement("li");
          const typeButton = document.createElement("button");
          typeButton.type = "button";
          typeButton.className = "ingenia-model-tree-storey-type-button";
          typeButton.textContent = `${label} (${objectIds.length})`;
          typeButton.title = `${label} (${objectIds.length})`;
          typeButton.setAttribute("aria-label", typeButton.title);
          typeButton.addEventListener("click", () => focusObjectIds(viewer, objectIds, onSelect));
          typeItem.appendChild(typeButton);
          typeList.appendChild(typeItem);
        });
        typesRendered = true;
      }
      setStoreyBranchExpanded(toggle, typeList, expanded);
      toggle.title = `${expanded ? "Thu gọn" : "Mở"} ${storey.label}`;
      toggle.setAttribute("aria-label", toggle.title);
    });
    row.append(toggle, button);
    item.append(row, typeList);
    group.appendChild(item);
  });
  body.appendChild(tree);
}

export function createModelTreeController(viewer, { container, locale = "vi", onOpenChange, onSelect } = {}) {
  const copy = resolveModelTreeCopy(locale);
  const host = container || document.querySelector("#viewport-shell") || document.body;
  const panel = document.createElement("section");
  panel.className = "ingenia-model-tree ingenia-viewport-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", copy.panel);
  const header = document.createElement("div");
  header.className = "ingenia-model-tree-header";
  const headerMain = document.createElement("div");
  headerMain.className = "ingenia-panel-header-main";
  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "ingenia-panel-drag-handle";
  dragHandle.title = locale === "vi" ? "Kéo để di chuyển Cây mô hình" : "Drag to move model tree";
  dragHandle.setAttribute("aria-label", dragHandle.title);
  dragHandle.setAttribute("data-ingenia-panel-grip", "six-dot");
  const title = document.createElement("strong");
  title.textContent = copy.title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ingenia-model-tree-close";
  close.title = copy.close;
  close.setAttribute("aria-label", copy.close);
  close.textContent = "×";
  headerMain.append(dragHandle, title);
  header.append(headerMain, close);
  const tabs = document.createElement("div");
  tabs.className = "ingenia-model-tree-tabs";
  tabs.setAttribute("role", "tablist");
  const search = document.createElement("div");
  search.className = "ingenia-model-tree-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.maxLength = 120;
  searchInput.placeholder = `${copy.search}...`;
  searchInput.setAttribute("aria-label", copy.search);
  searchInput.autocomplete = "off";
  const searchClear = document.createElement("button");
  searchClear.type = "button";
  searchClear.className = "ingenia-model-tree-search-clear";
  searchClear.title = copy.searchClear;
  searchClear.setAttribute("aria-label", copy.searchClear);
  searchClear.textContent = "×";
  searchClear.hidden = true;
  search.append(searchInput, searchClear);
  const searchStatus = document.createElement("p");
  searchStatus.className = "ingenia-model-tree-search-status";
  searchStatus.setAttribute("role", "status");
  searchStatus.hidden = true;
  const bodies = document.createElement("div");
  bodies.className = "ingenia-model-tree-bodies";
  const resizeHandle = document.createElement("button");
  resizeHandle.type = "button";
  resizeHandle.className = "ingenia-panel-resize-handle";
  resizeHandle.title = locale === "vi" ? "Kéo để giãn rộng Cây mô hình" : "Drag to resize Model Tree";
  resizeHandle.setAttribute("aria-label", resizeHandle.title);
  const containers = new Map();
  MODEL_TREE_TABS.forEach((tab) => {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "ingenia-model-tree-tab";
    tabButton.dataset.tab = tab.id;
    tabButton.textContent = copy.tabs[tab.id] || tab.label;
    tabButton.setAttribute("role", "tab");
    tabs.appendChild(tabButton);
    const body = document.createElement("div");
    body.className = "ingenia-model-tree-body";
    body.dataset.tab = tab.id;
    body.hidden = tab.id !== "containment";
    bodies.appendChild(body);
    containers.set(tab.id, { body, tabButton, config: tab });
  });
  panel.append(header, tabs, search, searchStatus, bodies, resizeHandle);
  host.appendChild(panel);
  const panelDrag = makeViewportPanelDraggable(panel, {
    handle: dragHandle,
    host,
    minimumWidth: 256,
    resizeHandle,
  });

  let activeTab = "containment";
  let open = false;
  let modelEntries = [];
  let plugins = new Map();
  let destroyed = false;
  let rebuildSerial = 0;
  let rebuildRetryCount = 0;
  let modelLoadedSubscription = null;
  let metaModelCreatedSubscription = null;
  let searchFrame = null;
  const unbindKeyboard = bindModelTreeKeyboardNavigation({ bodies, tabs });
  onOpenChange?.(false);
  function updateTabState() {
    containers.forEach(({ body, tabButton }, id) => {
      const active = id === activeTab;
      body.hidden = !active;
      tabButton.dataset.active = String(active);
      tabButton.setAttribute("aria-selected", String(active));
      tabButton.tabIndex = active ? 0 : -1;
    });
  }

  function attachPlugin(plugin) {
    plugin.on("nodeTitleClicked", (event) => {
      const ids = collectNodeObjectIds(viewer, plugin, event?.treeViewNode);
      focusObjectIds(viewer, ids, onSelect);
    });
  }

  function expandSearchPath(plugin, node) {
    const path = [];
    let current = node?.parent;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    path.forEach((parent) => {
      const switchElement = plugin?._renderService?.getSwitchElement?.(parent.nodeId);
      if (switchElement && !plugin?._renderService?.isExpanded?.(switchElement)) {
        plugin?._expandSwitchElement?.(switchElement);
      }
    });
  }

  function applySearch() {
    const entry = containers.get(activeTab);
    if (activeTab === "storeys" && entry) {
      const query = normalizeTreeSearchText(searchInput.value);
      const items = Array.from(entry.body.querySelectorAll("[data-model-tree-storey]"));
      searchClear.hidden = !query;
      let totalMatches = 0;
      items.forEach((item) => {
        const matches = !query || normalizeTreeSearchText(item.dataset.modelTreeStoreySearch).includes(query);
        item.hidden = !matches;
        if (matches) totalMatches += 1;
      });
      entry.body.querySelectorAll(".ingenia-model-tree-storey-model").forEach((group) => {
        const hasVisibleStorey = Boolean(group.querySelector("[data-model-tree-storey]:not([hidden])"));
        group.hidden = Boolean(query) && !hasVisibleStorey;
        if (query && hasVisibleStorey) {
          const toggle = group.querySelector(".ingenia-model-tree-disclosure");
          const content = group.querySelector("ul");
          if (toggle && content) setStoreyBranchExpanded(toggle, content, true);
        }
      });
      searchStatus.hidden = !query;
      searchStatus.textContent = query ? (totalMatches ? copy.results(totalMatches, false) : copy.noResults) : "";
      return;
    }
    const plugin = plugins.get(activeTab);
    if (!entry || !plugin) return;
    const plan = createTreeSearchPlan(plugin, searchInput.value);
    searchClear.hidden = !plan.query;
    if (!plan.query) {
      entry.body.querySelectorAll("li").forEach((item) => { item.hidden = false; });
      searchStatus.hidden = true;
      searchStatus.textContent = "";
      return;
    }
    plan.matchedNodeIds.forEach((nodeId) => expandSearchPath(plugin, plugin?._nodeNodes?.[nodeId]));
    entry.body.querySelectorAll("li").forEach((item) => {
      item.hidden = !plan.visibleNodeIds.has(String(item.id || ""));
    });
    searchStatus.hidden = false;
    searchStatus.textContent = plan.totalMatches ? copy.results(plan.totalMatches, plan.limited) : copy.noResults;
  }

  function scheduleSearch() {
    if (searchFrame) window.cancelAnimationFrame(searchFrame);
    searchFrame = window.requestAnimationFrame(() => {
      searchFrame = null;
      applySearch();
    });
  }

  async function rebuild({ reset = true } = {}) {
    if (destroyed || !open) return;
    if (!reset && plugins.has(activeTab)) {
      applySearch();
      return;
    }
    const serial = ++rebuildSerial;
    const { TreeViewPlugin } = await import("@xeokit/xeokit-sdk");
    if (destroyed || !open || serial !== rebuildSerial) return;
    if (reset) {
      plugins.forEach(destroyPlugin);
      plugins = new Map();
      containers.forEach(({ body }) => body.replaceChildren());
    }
    const entry = containers.get(activeTab);
    if (entry?.config.hierarchy === "storeys") {
      renderStoreyTree(entry.body, resolveModelStoreys(viewer, modelEntries), {
        emptyMessage: copy.emptyStoreys,
        onSelect,
        viewer,
      });
      updateTabState();
      applySearch();
      return;
    }
    if (entry && !plugins.has(activeTab)) {
      const { body, config } = entry;
      body.replaceChildren();
      const plugin = new TreeViewPlugin(viewer, {
        containerElement: body,
        hierarchy: config.hierarchy,
        autoAddModels: false,
        showIndeterminate: true,
      });
      populateModelTree({ viewer, plugin, modelEntries, hierarchy: config.hierarchy, body, emptyMessage: copy.emptyStoreys });
      decorateModelTreeBody(body, copy);
      attachPlugin(plugin);
      plugins.set(config.id, plugin);
    }
    updateTabState();
    applySearch();

    // XKT can expose scene geometry before the MetaModel has finalized. A
    // bounded retry keeps the direct-Xeokit tree behavior without polling.
    const hasMetaModels = Object.keys(viewer?.metaScene?.metaModels || {}).length > 0;
    const hasTreeNodes = Boolean(entry?.body?.querySelector('li, [data-tree-empty="true"]'));
    if (modelEntries.length && hasMetaModels && !hasTreeNodes && rebuildRetryCount < 3) {
      rebuildRetryCount += 1;
      window.setTimeout(() => {
        if (!destroyed && open) void rebuild().catch(() => {});
      }, 80);
    } else if (hasTreeNodes) {
      rebuildRetryCount = 0;
    }
  }

  function rebuildWhenMetadataIsReady(modelId) {
    if (
      !open
      || destroyed
      || !modelEntries.some((entry) => entry.modelId === String(modelId || ""))
    ) return;
    rebuildRetryCount = 0;
    void rebuild().catch(() => {});
  }

  modelLoadedSubscription = viewer?.scene?.on?.("modelLoaded", rebuildWhenMetadataIsReady) || null;
  metaModelCreatedSubscription = viewer?.metaScene?.on?.("metaModelCreated", rebuildWhenMetadataIsReady) || null;

  function closePanel() {
    open = false;
    panel.hidden = true;
    onOpenChange?.(false);
  }
  close.addEventListener("click", closePanel);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });
  tabs.addEventListener("click", (event) => {
    const id = event.target?.dataset?.tab;
    if (!containers.has(id)) return;
    activeTab = id;
    updateTabState();
    void rebuild({ reset: false }).catch(() => {});
  });
  searchInput.addEventListener("input", scheduleSearch);
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    applySearch();
    searchInput.focus();
  });

  return Object.freeze({
    mode(nextOpen) {
      open = nextOpen === true;
      panel.hidden = !open;
      onOpenChange?.(open);
      if (open) {
        window.requestAnimationFrame(panelDrag.clampToBounds);
        rebuildRetryCount = 0;
        window.requestAnimationFrame(() => searchInput.focus());
        return rebuild({ reset: plugins.size === 0 }).catch((error) => {
          closePanel();
          throw error;
        });
      }
      return undefined;
    },
    syncModels(nextModels = []) {
      const next = nextModels.map((candidate) => {
        const modelId = typeof candidate === "string" ? candidate : candidate?.modelId;
        const displayName = typeof candidate === "string" ? "" : candidate?.displayName;
        return {
          modelId: String(modelId || "").trim(),
          displayName: String(displayName || "").trim().slice(0, 200),
        };
      }).filter(({ modelId }) => modelId);
      const nextKey = next.map(({ modelId, displayName }) => `${modelId}:${displayName}`).join("|");
      const currentKey = modelEntries.map(({ modelId, displayName }) => `${modelId}:${displayName}`).join("|");
      if (nextKey === currentKey) return;
      modelEntries = next;
      rebuildRetryCount = 0;
      if (open) void rebuild().catch(() => {});
    },
    destroy() {
      destroyed = true;
      rebuildSerial += 1;
      if (modelLoadedSubscription) viewer?.scene?.off?.(modelLoadedSubscription);
      if (metaModelCreatedSubscription) viewer?.metaScene?.off?.(metaModelCreatedSubscription);
      if (searchFrame) window.cancelAnimationFrame(searchFrame);
      unbindKeyboard();
      panelDrag.destroy();
      plugins.forEach(destroyPlugin);
      plugins = new Map();
      panel.remove();
    },
  });
}
