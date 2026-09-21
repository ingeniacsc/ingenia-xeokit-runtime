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

  function register(token, objectId) {
    const normalizedToken = String(token || "");
    const normalizedObjectId = String(objectId || "");
    if (!normalizedToken || !normalizedObjectId) {
      throw new Error("A Viewer selection reference and xeokit object identifier are required.");
    }
    const existingObjectId = objectIdByToken.get(normalizedToken);
    if (existingObjectId && existingObjectId !== normalizedObjectId) {
      throw new Error("Viewer selection reference is already bound to another object.");
    }
    const existingToken = tokenByObjectId.get(normalizedObjectId);
    if (existingToken && existingToken !== normalizedToken) {
      // The backend issues a new short-lived opaque reference for each pick.
      // Retire the older local reference so a repeated click can cross the iframe boundary.
      objectIdByToken.delete(existingToken);
    }
    objectIdByToken.set(normalizedToken, normalizedObjectId);
    tokenByObjectId.set(normalizedObjectId, normalizedToken);
    return normalizedToken;
  }

  function tokenForObjectId(objectId) {
    return tokenByObjectId.get(String(objectId || "")) || "";
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
    register,
    tokenForObjectId,
    toObjectIds,
    clear() {
      objectIdByToken.clear();
      tokenByObjectId.clear();
      nextToken = 1;
    },
  });
}
