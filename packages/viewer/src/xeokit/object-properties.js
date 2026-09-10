// SPDX-License-Identifier: AGPL-3.0-only

const MAX_GROUP_SAMPLE = 50;
const MAX_PROPERTY_ROWS = 16;
const MAX_PROPERTY_LABEL_LENGTH = 120;
const MAX_PROPERTY_VALUE_LENGTH = 240;
const MAX_PROPERTY_SET_LENGTH = 120;
const MAX_PROPERTY_SETS_PER_OBJECT = 32;
const MAX_PROPERTIES_PER_SET = 64;
const MAX_CANONICAL_ROWS = 128;
const MAX_CANONICAL_VALUE_LENGTH = 512;
const STANDARD_PROPERTY_SET = /^(?:Pset_|Qto_)/i;

const TYPE_ALIASES = [
  "typename", "type_name", "objecttype", "object_type", "family", "reference",
  "model", "modelnumber", "producttype",
];
const SPEC_ALIASES = [
  "power", "nominalpower", "wattage", "coolingcapacity", "heatingcapacity",
  "capacity", "flowrate", "airflow", "voltage", "current", "nominaldiameter",
  "diameter", "size", "firerating", "rating",
];
const MATCH_ALIASES = Object.freeze({
  material: ["material", "materialname", "finish", "structuralmaterial", "concretegrade"],
  system: ["system", "systemname", "systemtype", "distributionsystem", "circuit"],
  tag: ["tag", "mark", "typemark", "elementmark", "assettag", "devicetag"],
});
const QUANTITY_ALIASES = [
  "area", "count", "crosssectionarea", "depth", "diameter", "grossarea",
  "grossvolume", "height", "length", "mass", "netarea", "netvolume",
  "perimeter", "thickness", "volume", "weight", "width",
];
const SAFE_TECHNICAL_KEYS = new Set(
  [...TYPE_ALIASES, ...SPEC_ALIASES, ...Object.values(MATCH_ALIASES).flat(), ...QUANTITY_ALIASES]
    .map((value) => String(value).replace(/[^a-z0-9]/gi, "").toLowerCase()),
);

function normalizeKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function boundText(value, maxLength) {
  const text = String(value).trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function displayValue(value, locale) {
  if (value === true) return locale === "vi" ? "Có" : "Yes";
  if (value === false) return locale === "vi" ? "Không" : "No";
  if (value === null || value === undefined || value === "" || typeof value === "object") return "";
  return boundText(value, MAX_PROPERTY_VALUE_LENGTH);
}

function rawPropertyValue(property) {
  if (property?.value === null || property?.value === undefined || typeof property.value === "object") return "";
  const value = String(property.value).trim();
  const unitValue = property?.unit || property?.units;
  const unit = unitValue === null || unitValue === undefined || typeof unitValue === "object"
    ? "" : String(unitValue).trim();
  return value && unit ? `${value} ${unit}` : value;
}

function propertyValue(property, locale) {
  const value = displayValue(property?.value, locale);
  const unit = displayValue(property?.unit || property?.units, locale);
  return boundText(value && unit ? `${value} ${unit}` : value, MAX_PROPERTY_VALUE_LENGTH);
}

function resolveMetaObject(viewer, objectId) {
  return viewer?.metaScene?.metaObjects?.[objectId] || null;
}

function resolvePropertySet(metaScene, propertySet) {
  if (typeof propertySet === "string") return metaScene?.propertySets?.[propertySet] || null;
  return propertySet && typeof propertySet === "object" ? propertySet : null;
}

function standardPropertyRows(viewer, metaObject, locale, workBudget) {
  const rows = [];
  const propertySets = Array.isArray(metaObject?.propertySets) ? metaObject.propertySets : [];
  let complete = propertySets.length <= MAX_PROPERTY_SETS_PER_OBJECT;
  scan: for (const candidate of propertySets.slice(0, MAX_PROPERTY_SETS_PER_OBJECT)) {
    if (workBudget && !workBudget.consume()) { complete = false; break; }
    const propertySet = resolvePropertySet(viewer?.metaScene, candidate);
    const rawSetName = String(propertySet?.name || "").trim();
    if (!STANDARD_PROPERTY_SET.test(rawSetName) || !Array.isArray(propertySet?.properties)) continue;
    if (rawSetName.length > MAX_PROPERTY_SET_LENGTH) complete = false;
    const setName = boundText(rawSetName, MAX_PROPERTY_SET_LENGTH);
    if (propertySet.properties.length > MAX_PROPERTIES_PER_SET) complete = false;
    for (const property of propertySet.properties.slice(0, MAX_PROPERTIES_PER_SET)) {
      if (workBudget && !workBudget.consume()) { complete = false; break scan; }
      const name = boundText(property?.name || "", MAX_PROPERTY_LABEL_LENGTH);
      const value = propertyValue(property, locale);
      if (!name || !value || !SAFE_TECHNICAL_KEYS.has(normalizeKey(name))) continue;
      const rawValue = rawPropertyValue(property);
      if (rawValue.length > MAX_CANONICAL_VALUE_LENGTH) complete = false;
      if (rows.length >= MAX_CANONICAL_ROWS) { complete = false; break scan; }
      rows.push({
        canonicalValue: normalizeValue(rawValue.slice(0, MAX_CANONICAL_VALUE_LENGTH)),
        key: `${setName}.${name}`,
        label: name,
        setName,
        value,
      });
    }
  }
  return { complete, rows };
}

function findPropertyValue(rows, aliases) {
  const expected = new Set(aliases.map(normalizeKey));
  return rows.find((row) => expected.has(normalizeKey(row.label)))?.value || "";
}

export function resolveTechnicalMatchValue(viewer, objectId, scope, workBudget) {
  const metaObject = resolveMetaObject(viewer, objectId);
  if (!metaObject) return "";
  const type = normalizeValue(metaObject.type || viewer?.scene?.objects?.[objectId]?.type);
  if (scope === "type") return type;
  const propertyResult = standardPropertyRows(viewer, metaObject, "en", workBudget);
  if (!propertyResult.complete) return "";
  if (MATCH_ALIASES[scope]) return normalizeValue(findPropertyValue(propertyResult.rows, MATCH_ALIASES[scope]));
  if (scope !== "exact" || !type) return "";
  const properties = propertyResult.rows
    .map((row) => [normalizeKey(row.setName), normalizeKey(row.label), row.canonicalValue])
    .filter(([, name, value]) => name && value)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return properties.length ? JSON.stringify({ type, properties }) : "";
}

function resolveStorey(viewer, objectId) {
  let metaObject = resolveMetaObject(viewer, objectId);
  for (let depth = 0; metaObject && depth < 32; depth += 1) {
    if (metaObject.type === "IfcBuildingStorey") return String(metaObject.name || metaObject.id || "");
    const parent = metaObject.parent;
    metaObject = typeof parent === "string" ? resolveMetaObject(viewer, parent) : parent || null;
  }
  return "";
}

function identityRows(viewer, objectId, metaObject, locale, access) {
  const isVi = locale === "vi";
  const localIdentifier = String(objectId || "").split("#").pop() || String(objectId || "");
  const properties = standardPropertyRows(viewer, metaObject, locale).rows;
  const values = [
    [access.objectName, isVi ? "Tên đối tượng" : "Object name", metaObject?.name],
    [access.ifcType, isVi ? "Loại IFC" : "IFC type", metaObject?.type],
    [access.typeName, isVi ? "Tên kiểu" : "Type name", findPropertyValue(properties, TYPE_ALIASES)],
    [access.globalId, "GlobalId", metaObject?.globalId || metaObject?.globalID || localIdentifier],
    [access.storey, isVi ? "Tầng" : "Storey", resolveStorey(viewer, objectId)],
    [access.tag, "Mark / Tag", findPropertyValue(properties, MATCH_ALIASES.tag)],
  ];
  return values
    .filter(([visible]) => visible)
    .map(([, label, value]) => ({ label, value: displayValue(value, locale) }))
    .filter((row) => row.value);
}

function commonPropertyRows(viewer, objectIds, locale) {
  const sampled = objectIds.slice(0, MAX_GROUP_SAMPLE);
  if (!sampled.length) return [];
  const first = standardPropertyRows(viewer, resolveMetaObject(viewer, sampled[0]), locale).rows;
  const candidates = new Map(first.map((row) => [row.key, row]));
  for (const objectId of sampled.slice(1)) {
    const values = new Map(
      standardPropertyRows(viewer, resolveMetaObject(viewer, objectId), locale).rows
        .map((row) => [row.key, row.canonicalValue]),
    );
    for (const [key, row] of candidates) {
      if (values.get(key) !== row.canonicalValue) candidates.delete(key);
    }
    if (!candidates.size) break;
  }
  return Array.from(candidates.values()).slice(0, MAX_PROPERTY_ROWS);
}

export function buildObjectPropertiesSnapshot(viewer, identifiers, scope = "selection", locale = "vi", access = {}) {
  const objectIds = Array.from(new Set((identifiers || []).filter(Boolean)));
  if (!objectIds.length) return null;
  const representativeId = objectIds[0];
  const metaObject = resolveMetaObject(viewer, representativeId);
  const propertyRows = access.propertySets
    ? (objectIds.length === 1
      ? standardPropertyRows(viewer, metaObject, locale).rows.slice(0, MAX_PROPERTY_ROWS)
      : commonPropertyRows(viewer, objectIds, locale))
    : [];
  return Object.freeze({
    count: objectIds.length,
    identityRows: identityRows(viewer, representativeId, metaObject, locale, access),
    propertyRows,
    propertySetsVisible: access.propertySets === true,
    representativeId,
    sampledCount: Math.min(objectIds.length, MAX_GROUP_SAMPLE),
    scope,
  });
}
