// SPDX-License-Identifier: AGPL-3.0-only

const TOKEN_PREFIX = "object.session.";

export function createObjectIdentifierRegistry() {
  const objectIdByToken = new Map();
  const tokenByObjectId = new Map();
  let nextToken = 1;

  function toToken(objectId) {
    const normalized = String(objectId || "");
    if (!normalized) throw new Error("A xeokit object identifier is required.");
    const existing = tokenByObjectId.get(normalized);
    if (existing) return existing;
    const token = `${TOKEN_PREFIX}${String(nextToken).padStart(12, "0")}`;
    nextToken += 1;
    tokenByObjectId.set(normalized, token);
    objectIdByToken.set(token, normalized);
    return token;
  }

  function toObjectIds(tokens) {
    return tokens.map((token) => {
      const objectId = objectIdByToken.get(token);
      if (!objectId) throw new Error("Object identifier is not registered in this viewer session.");
      return objectId;
    });
  }

  return Object.freeze({
    toToken,
    toObjectIds,
    clear() {
      objectIdByToken.clear();
      tokenByObjectId.clear();
      nextToken = 1;
    },
  });
}
