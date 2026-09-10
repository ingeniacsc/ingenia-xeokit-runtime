// SPDX-License-Identifier: AGPL-3.0-only

const SCOPE_LABELS = Object.freeze({
  exact: { en: 'identical objects', vi: 'cấu kiện giống hệt' },
  material: { en: 'objects with the same material', vi: 'cấu kiện cùng vật liệu' },
  storey: { en: 'objects on the same storey', vi: 'cấu kiện cùng tầng' },
  system: { en: 'objects in the same system', vi: 'cấu kiện cùng hệ thống' },
  type: { en: 'objects with the same IFC type', vi: 'cấu kiện cùng loại IFC' },
  tag: { en: 'objects with the same Mark/Tag', vi: 'cấu kiện cùng Mark/Tag' },
  visible: { en: 'visible objects', vi: 'cấu kiện đang hiển thị' },
});

function labelFor(scope, locale) {
  const language = locale === 'vi' ? 'vi' : 'en';
  return SCOPE_LABELS[scope]?.[language] || SCOPE_LABELS.visible[language];
}
function formatCount(value, locale) {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(Math.max(0, Number(value) || 0));
}

export function createSelectionOperationStatus({
  container,
  locale = 'en',
  completionDurationMs = 5_000,
  timers = globalThis,
} = {}) {
  let dismissTimer = null;

  const clearDismissTimer = () => {
    if (dismissTimer !== null) timers.clearTimeout?.(dismissTimer);
    dismissTimer = null;
  };
  const show = (message) => {
    if (!container) return;
    clearDismissTimer();
    container.hidden = false;
    container.textContent = message;
  };
  const hide = () => {
    clearDismissTimer();
    if (container) container.hidden = true;
  };

  return Object.freeze({
    progress({ scope, processed, total, matched }) {
      const target = labelFor(scope, locale);
      const progress = `${formatCount(processed, locale)}/${formatCount(total, locale)}`;
      const count = formatCount(matched, locale);
      show(locale === 'vi'
        ? `Đang chọn ${target}: ${progress}. Đã khớp ${count}.`
        : `Selecting ${target}: ${progress}. ${count} matched.`);
    },
    complete({ scope, selectedCount }) {
      const target = labelFor(scope, locale);
      const count = formatCount(selectedCount, locale);
      show(locale === 'vi'
        ? `Đã chọn ${count} ${target} đang hiển thị.`
        : `Selected ${count} visible ${target}.`);
      dismissTimer = timers.setTimeout?.(hide, completionDurationMs) ?? null;
    },
    clear: hide,
    destroy: hide,
  });
}
