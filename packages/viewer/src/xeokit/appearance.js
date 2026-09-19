// SPDX-License-Identifier: AGPL-3.0-only

const IFC_TYPE_COLOR_PALETTE = Object.freeze({
  IfcBeam: [0.58, 0.55, 0.52],
  IfcColumn: [0.70, 0.68, 0.65],
  IfcDoor: [0.52, 0.38, 0.26],
  IfcDuctFitting: [0.85, 0.40, 0.20],
  IfcDuctSegment: [0.85, 0.40, 0.20],
  IfcFlowFitting: [0.30, 0.65, 0.45],
  IfcFlowTerminal: [0.30, 0.65, 0.45],
  IfcFooting: [0.55, 0.50, 0.45],
  IfcPipeFitting: [0.20, 0.55, 0.80],
  IfcPipeSegment: [0.20, 0.55, 0.80],
  IfcSlab: [0.76, 0.74, 0.72],
  IfcWall: [0.90, 0.87, 0.80],
  IfcWallStandardCase: [0.90, 0.87, 0.80],
  IfcWindow: [0.55, 0.78, 0.95],
});
const BUSINESS_FILTER_DIMMED_OPACITY = 0.08;
const IFC_SPACE_OPACITY = 0.12;
const DISCIPLINE_GLASS_OPACITY = 0.36;
const SELECTED_OBJECT_OPACITY = 0.35;
const SOURCE_OPACITY_IS_OPAQUE = 0.995;
const MAX_PRESENTATION_PROPERTY_SETS = 32;
const MAX_PRESENTATION_PROPERTIES = 64;
const DISCIPLINE_CODE = /^[A-Z][A-Z0-9_]{1,31}$/;
const SAFE_STATUS_CODE = /^[A-Za-z0-9._:-]{1,64}$/;
const GLASS_MATERIAL_VALUE = /(?:glass|glazing|glazed|k\u00ednh|kinh)/i;
const MATERIAL_PROPERTY_NAME = /(?:material|finish|glazing|glass|v\u1eadt\s*li\u1ec7u|vat\s*lieu)/i;

export function resolveIfcType(viewer, entity) {
  const id = String(entity?.id || '');
  const candidates = [
    entity?.type,
    viewer.metaScene?.metaObjects?.[id]?.type,
    id.split('#').pop(),
    id.split(':').pop(),
    id.split('/').pop(),
    id.split('|').pop(),
  ].filter(Boolean);
  return candidates.find((candidate) => /^Ifc[A-Za-z0-9_]+$/.test(String(candidate))) || '';
}

function resolvePropertySet(metaScene, candidate) {
  if (typeof candidate === "string") return metaScene?.propertySets?.[candidate] || null;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function hasGlassMetadata(viewer, entity) {
  const metaObject = viewer.metaScene?.metaObjects?.[entity?.id];
  if (!metaObject) return false;
  const directValues = [metaObject.name, metaObject.objectType, metaObject.predefinedType];
  if (directValues.some((value) => GLASS_MATERIAL_VALUE.test(String(value || "")))) return true;
  const propertySets = Array.isArray(metaObject.propertySets) ? metaObject.propertySets : [];
  return propertySets.slice(0, MAX_PRESENTATION_PROPERTY_SETS).some((candidate) => {
    const propertySet = resolvePropertySet(viewer.metaScene, candidate);
    if (GLASS_MATERIAL_VALUE.test(String(propertySet?.name || ""))) return true;
    const properties = Array.isArray(propertySet?.properties) ? propertySet.properties : [];
    return properties.slice(0, MAX_PRESENTATION_PROPERTIES).some((property) => (
      MATERIAL_PROPERTY_NAME.test(String(property?.name || ""))
      && GLASS_MATERIAL_VALUE.test(String(property?.value || ""))
    ));
  });
}

function resolvePresentationOpacity(viewer, entity, sourceOpacity) {
  const preservedOpacity = Number.isFinite(sourceOpacity) ? sourceOpacity : 1;
  const fallbackOpacity = (value) => (
    preservedOpacity < SOURCE_OPACITY_IS_OPAQUE ? preservedOpacity : value
  );
  if (resolveIfcType(viewer, entity) === "IfcSpace") return fallbackOpacity(IFC_SPACE_OPACITY);
  if (resolveIfcType(viewer, entity) === "IfcWindow" || hasGlassMetadata(viewer, entity)) {
    return fallbackOpacity(DISCIPLINE_GLASS_OPACITY);
  }
  return preservedOpacity;
}

function resolveSelectionOpacity(entity, opacity) {
  return entity?.selected === true ? Math.min(opacity, SELECTED_OBJECT_OPACITY) : opacity;
}

function normalizeDisciplineAppearance(value) {
  const disciplineCode = String(value?.disciplineCode || '').trim();
  const color = String(value?.color || '').trim();
  const opacity = Number(value?.opacity);
  if (!DISCIPLINE_CODE.test(disciplineCode) || !/^#[0-9a-fA-F]{6}$/.test(color) || !Number.isFinite(opacity)) return null;
  return {
    disciplineCode,
    color: color.toUpperCase(),
    opacity: Math.max(0.05, Math.min(1, opacity)),
    xray: value?.xray === true,
  };
}

function applyColorMode(viewer, mode, model, sourceOpacityFor, disciplineAppearances = new Map()) {
  Object.values(viewer.scene.objects || {}).forEach((entity) => {
    if (!entity) return;
    if (mode === 'ifc') {
      entity.colorize = IFC_TYPE_COLOR_PALETTE[resolveIfcType(viewer, entity)] || null;
    } else if (mode === 'discipline') {
      const disciplineCode = String(model?.disciplineCodeFor?.(entity.id) || '');
      const appearance = disciplineAppearances.get(disciplineCode);
      entity.colorize = colorFromHex(appearance?.color || model?.disciplineColorFor?.(entity.id));
      if ('xrayed' in entity) entity.xrayed = appearance?.xray === true;
      entity.opacity = resolveSelectionOpacity(
        entity,
        appearance ? appearance.opacity : resolvePresentationOpacity(viewer, entity, sourceOpacityFor?.(entity)),
      );
      return;
    } else {
      entity.colorize = null;
    }
    if ('xrayed' in entity) entity.xrayed = false;
    entity.opacity = resolveSelectionOpacity(
      entity,
      resolvePresentationOpacity(viewer, entity, sourceOpacityFor?.(entity)),
    );
  });
  viewer.scene.render(true);
}

function colorFromHex(value) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(String(value || ''));
  if (!match) return null;
  return [
    Number.parseInt(match[1].slice(0, 2), 16) / 255,
    Number.parseInt(match[1].slice(2, 4), 16) / 255,
    Number.parseInt(match[1].slice(4, 6), 16) / 255,
  ];
}

function normalizeStatusCode(value) {
  const normalized = String(value || '').trim();
  return SAFE_STATUS_CODE.test(normalized) ? normalized : '';
}

function applyBusinessStatuses(viewer, entries, replace, statusesByObjectId) {
  const scene = viewer.scene;
  if (replace) {
    statusesByObjectId.clear();
    Object.values(scene.objects || {}).forEach((entity) => {
      if (!entity) return;
      entity.colorize = null;
      entity.highlighted = false;
    });
  }
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const modelId = String(entry?.modelId || '');
    const globalId = String(entry?.globalId || '');
    const color = colorFromHex(entry?.color);
    if (!modelId || !globalId || !color) return;
    const objectId = `${modelId}#${globalId}`;
    const entity = scene.objects?.[objectId];
    if (!entity) return;
    entity.colorize = color;
    entity.highlighted = entry.emphasize === true;
    const statusCode = normalizeStatusCode(entry?.status);
    if (statusCode) statusesByObjectId.set(objectId, statusCode);
    else statusesByObjectId.delete(objectId);
  });
  scene.render(true);
}

function applyBusinessStatusFilter(viewer, statusesByObjectId, statusCodes, sourceOpacityFor) {
  const activeStatusCodes = new Set(
    (Array.isArray(statusCodes) ? statusCodes : [])
      .map(normalizeStatusCode)
      .filter(Boolean),
  );
  Object.values(viewer.scene.objects || {}).forEach((entity) => {
    if (!entity) return;
    const matches = activeStatusCodes.size === 0 || activeStatusCodes.has(statusesByObjectId.get(entity.id));
    // Dim non-matching objects without overriding manual tree visibility.
    const presentationOpacity = matches
      ? resolvePresentationOpacity(viewer, entity, sourceOpacityFor?.(entity))
      : BUSINESS_FILTER_DIMMED_OPACITY;
    entity.opacity = resolveSelectionOpacity(entity, presentationOpacity);
  });
  viewer.scene.render(true);
}

export function createAppearanceController(viewer, { model, visibility } = {}) {
  let colorMode = 'source';
  let dayNightMode = 'day';
  let businessStatusFilter = [];
  const businessStatusesByObjectId = new Map();
  const disciplineAppearances = new Map();
  const sourceOpacityByEntity = new WeakMap();
  const sourceOpacityFor = (entity) => {
    if (!entity || typeof entity !== "object") return 1;
    if (sourceOpacityByEntity.has(entity)) return sourceOpacityByEntity.get(entity);
    const rawOpacity = Number(entity.opacity);
    const sourceOpacity = Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 1;
    sourceOpacityByEntity.set(entity, sourceOpacity);
    return sourceOpacity;
  };
  return Object.freeze({
    apply({ identifiers = [], options = {} }) {
      if (options.mode) {
        if (!['source', 'ifc', 'discipline', 'business'].includes(options.mode)) {
          throw new Error('Unsupported isolated viewport color mode.');
        }
        colorMode = options.mode;
        applyColorMode(viewer, colorMode, model, sourceOpacityFor, disciplineAppearances);
      }
      if (options.reset) {
        viewer.scene.setObjectsColorized(viewer.scene.colorizedObjectIds, null);
        viewer.scene.setObjectsOpacity(viewer.scene.opacityObjectIds, 1);
        Object.values(viewer.scene.objects || {}).forEach((entity) => {
          if (entity && 'xrayed' in entity) entity.xrayed = false;
        });
        applyColorMode(viewer, colorMode, model, sourceOpacityFor, disciplineAppearances);
        return;
      }
      if (Array.isArray(options.businessStatuses) && colorMode === 'business') {
        applyBusinessStatuses(
          viewer,
          options.businessStatuses,
          options.replaceBusinessStatuses === true,
          businessStatusesByObjectId,
        );
        return;
      }
      if (Array.isArray(options.businessStatusFilter) && colorMode === 'business') {
        businessStatusFilter = options.businessStatusFilter;
        applyBusinessStatusFilter(viewer, businessStatusesByObjectId, options.businessStatusFilter, sourceOpacityFor);
        return;
      }
      if (options.disciplineAppearance && colorMode === 'discipline') {
        const appearance = normalizeDisciplineAppearance(options.disciplineAppearance);
        if (!appearance) throw new Error('Invalid discipline appearance.');
        disciplineAppearances.set(appearance.disciplineCode, appearance);
        applyColorMode(viewer, colorMode, model, sourceOpacityFor, disciplineAppearances);
        return;
      }
      if (options.mode) return;
      if (options.xrayOthers === true) {
        const selected = new Set(identifiers);
        Object.values(viewer.scene.objects || {}).forEach((entity) => {
          if (!entity) return;
          // X-Ray must not reveal objects hidden through the model tree.
          if ('xrayed' in entity) entity.xrayed = !selected.has(entity.id);
        });
        visibility?.reapply?.();
        viewer.scene.render(true);
        return;
      }
      if (Array.isArray(options.color) && options.color.length === 3) {
        viewer.scene.setObjectsColorized(identifiers, options.color);
      }
      if (Number.isFinite(options.opacity)) {
        const requestedOpacity = Math.max(0, Math.min(1, options.opacity));
        viewer.scene.setObjectsOpacity(
          identifiers,
          requestedOpacity,
        );
        const selectedIdentifiers = identifiers.filter(
          (identifier) => viewer.scene.objects?.[identifier]?.selected === true,
        );
        if (selectedIdentifiers.length > 0) {
          viewer.scene.setObjectsOpacity(
            selectedIdentifiers,
            Math.min(requestedOpacity, SELECTED_OBJECT_OPACITY),
          );
        }
      }
    },
    reapply() {
      if (colorMode === 'business') {
        applyBusinessStatusFilter(
          viewer,
          businessStatusesByObjectId,
          businessStatusFilter,
          sourceOpacityFor,
        );
        return;
      }
      applyColorMode(viewer, colorMode, model, sourceOpacityFor, disciplineAppearances);
    },
    dayNight(mode) {
      dayNightMode = mode === "night" ? "night" : "day";
      viewer.scene.canvas.backgroundColor = dayNightMode === "night" ? [0.031, 0.184, 0.208] : [0.957, 0.937, 0.902];
      const shell = viewer.scene.canvas.canvas?.closest?.('#viewport-shell');
      if (shell) shell.dataset.visualMode = dayNightMode;
      viewer.scene.render(true);
    },
    state() {
      return Object.freeze({
        colorMode: ['ifc', 'discipline'].includes(colorMode) ? colorMode : 'source',
        dayNightMode,
      });
    },
  });
}
