// Pure: a few human-readable names out of a captured response, for the little preview in the app ("3 announcements:
// Welcome, Week 2 reading, ..."). Looks for the first list of objects that have a name or title.
const NAME_KEYS = ['name', 'title', 'display_name', 'subject', 'label', 'longName', 'shortName'];

function nameOf(item) {
  if (item === null || typeof item !== 'object') return null;
  for (const key of NAME_KEYS) if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim().slice(0, 80);
  return null;
}

export function peekSample(body, max = 3) {
  const lists = [];
  if (Array.isArray(body)) lists.push(body);
  else if (body && typeof body === 'object') {
    const own = nameOf(body);
    if (own) return [own];
    for (const v of Object.values(body)) if (Array.isArray(v)) lists.push(v);
    // GraphQL: data -> something -> nodes
    const data = body.data;
    if (data && typeof data === 'object') {
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) lists.push(v);
        else if (v && typeof v === 'object') for (const w of Object.values(v)) if (Array.isArray(w)) lists.push(w);
      }
    }
  }
  for (const list of lists) {
    const names = list.map(nameOf).filter(Boolean);
    if (names.length) return names.slice(0, max);
  }
  return [];
}
