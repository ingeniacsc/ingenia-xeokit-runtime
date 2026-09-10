// SPDX-License-Identifier: AGPL-3.0-only

export const MAX_TREE_SEARCH_RESULTS = 250;

export function normalizeTreeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLocaleLowerCase("vi");
}

export function createTreeSearchPlan(plugin, rawQuery, limit = MAX_TREE_SEARCH_RESULTS) {
  const query = normalizeTreeSearchText(rawQuery);
  const nodes = Object.values(plugin?._nodeNodes || {});
  if (!query) {
    return {
      query,
      totalMatches: 0,
      limited: false,
      matchedNodeIds: [],
      visibleNodeIds: new Set(),
    };
  }

  const matchedNodes = [];
  let totalMatches = 0;
  nodes.forEach((node) => {
    if (!normalizeTreeSearchText(node?.title).includes(query)) return;
    totalMatches += 1;
    if (matchedNodes.length < limit) matchedNodes.push(node);
  });

  const visibleNodeIds = new Set();
  matchedNodes.forEach((node) => {
    let current = node;
    while (current) {
      if (current.nodeId) visibleNodeIds.add(String(current.nodeId));
      current = current.parent;
    }
  });

  return {
    query,
    totalMatches,
    limited: totalMatches > matchedNodes.length,
    matchedNodeIds: matchedNodes.map((node) => String(node.nodeId || "")).filter(Boolean),
    visibleNodeIds,
  };
}
