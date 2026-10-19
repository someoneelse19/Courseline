// Pure: the structure of a JSON value with every value removed. Lets us see what a response contains (field names and
// types) without keeping anything the student wrote or earned. Arrays show only their first element.
const MAX_DEPTH = 9;
const MAX_KEYS = 60;

export function skeleton(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? [] : depth >= MAX_DEPTH ? ['…'] : [skeleton(value[0], depth + 1)];
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '{…}';
    const out = {};
    for (const key of Object.keys(value).slice(0, MAX_KEYS)) out[key] = skeleton(value[key], depth + 1);
    return out;
  }
  return typeof value;
}

/**
 * Everything the copy button hands over: the structure (no values) of one saved response per kind we read, and of
 * the first response from each address we do not read yet.
 */
export function collectShapes(all) {
  const read = {};
  for (const [key, rec] of Object.entries(all)) {
    if (key.startsWith('cap:') && rec?.kind && !(rec.kind in read)) read[rec.kind] = skeleton(rec.body);
  }
  return { read, unread: all.shapes ?? {} };
}
