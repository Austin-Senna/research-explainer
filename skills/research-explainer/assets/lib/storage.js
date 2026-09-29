// Every path is wrapped: private windows, blocked site data, quota limits and
// thumbnail capture all make localStorage throw or return null. The page must
// render correctly in all of those cases.

const PREFIX = 'research-explainer:';

function defaultBacking() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function createStore(slug, backing = defaultBacking()) {
  const key = PREFIX + slug;
  return {
    load() {
      try {
        const raw = backing?.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch { return {}; }
    },
    save(obj) {
      try {
        backing.setItem(key, JSON.stringify(obj));
        return true;
      } catch { return false; }
    },
    clear() {
      try { backing.removeItem(key); return true; } catch { return false; }
    },
  };
}
