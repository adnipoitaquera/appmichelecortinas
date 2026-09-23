export const KEYS = Object.freeze([
  'michele_clientes', 'michele_pedidos', 'michele_fornecedores', 'michele_profissionais',
  'michele_produtos_voal', 'michele_produtos_forro', 'michele_produtos_persiana',
  'michele_produtos_acessorios', 'michele_produtos_motorizacao', 'michele_produtos_personalizados',
  'michele_numero_orcamento', 'michele_numero_pedido', 'michele_financeiro',
  'michele_producao', 'michele_config_empresa',
]);
const OBJECTS = new Set(['michele_producao', 'michele_config_empresa']);
const COUNTERS = new Set(['michele_numero_orcamento', 'michele_numero_pedido']);
const COMMON = new Set(['michele_clientes', 'michele_pedidos', 'michele_financeiro',
  'michele_producao', ...COUNTERS]);
export const label = key => key.replace('michele_', '').replaceAll('_', ' ');
export const canWrite = (key, role) => KEYS.includes(key) && (role === 'Administrador' || COMMON.has(key));
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const equal = (a, b) => canonical(a) === canonical(b);
export function sanitize(key, value) {
  if (key === 'michele_profissionais' && Array.isArray(value)) {
    return value.map(({ senha, ...record }) => record);
  }
  return value;
}
export function validateValue(key, value) {
  if (!KEYS.includes(key)) throw new Error('Cadastro desconhecido: ' + key);
  if (COUNTERS.has(key)) {
    const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Numeração inválida: ' + label(key));
    return count;
  }
  if (OBJECTS.has(key)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Formato inválido: ' + label(key));
  } else if (!Array.isArray(value) || value.some(x => !x || typeof x !== 'object' || Array.isArray(x))) {
    throw new Error('Lista inválida: ' + label(key));
  }
  return sanitize(key, value);
}
export function dataset(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Backup inválido.');
  const result = {};
  for (const key of KEYS) if (Object.hasOwn(input, key)) result[key] = validateValue(key, input[key]);
  if (!Object.keys(result).length) throw new Error('Este arquivo não contém cadastros do sistema.');
  return result;
}
export function readLegacy(storage) {
  const result = {};
  for (const key of KEYS) {
    const raw = storage.getItem(key);
    if (raw !== null) {
      try { result[key] = validateValue(key, JSON.parse(raw)); }
      catch { throw new Error('Não foi possível ler ' + label(key) + '. Os dados originais foram preservados.'); }
    }
  }
  return result;
}
function identity(record) {
  if (record.codigo) return 'codigo:' + record.codigo;
  if (record.idDocumento) return 'documento:' + record.idDocumento;
  if (record.id !== undefined && record.id !== null && record.id !== '') return 'id:' + record.id;
  if (record.nome) return 'nome:' + record.nome;
  return 'conteudo:' + canonical(record);
}
// Importação é aditiva: ausências no backup nunca apagam registros na nuvem.
// IDs iguais com conteúdo diferente sempre precisam de escolha explícita.
export function mergeImport(remote, source, choices = {}) {
  const merged = structuredClone(remote);
  const conflicts = [];
  function choose(key, id, cloud, incoming) {
    const token = JSON.stringify([key, id]);
    if (choices[token] === 'source') return incoming;
    if (choices[token] !== 'cloud') conflicts.push({ token, key, id, cloud, incoming });
    return cloud;
  }
  for (const [key, incoming] of Object.entries(dataset(source))) {
    const cloud = remote[key];
    if (cloud === undefined || equal(cloud, incoming)) { merged[key] = incoming; continue; }
    if (COUNTERS.has(key)) { merged[key] = Math.max(Number(cloud), incoming); continue; }
    if (OBJECTS.has(key)) {
      merged[key] = { ...cloud };
      for (const [id, value] of Object.entries(incoming)) {
        Object.defineProperty(merged[key], id, { value: !Object.hasOwn(cloud, id) || equal(cloud[id], value)
          ? value : choose(key, id, cloud[id], value), enumerable: true, writable: true, configurable: true });
      }
    } else {
      // Existing duplicate identities are preserved. Ambiguous imports are rejected.
      const ids = new Map();
      const rows = structuredClone(cloud);
      for (let i = 0; i < rows.length; i++) {
        const id = identity(rows[i]);
        if (ids.has(id)) throw new Error('IDs repetidos em ' + label(key) + '. Revise os registros antes de importar.');
        ids.set(id, i);
      }
      const sourceIds = new Set();
      for (const record of incoming) {
        const id = identity(record);
        if (sourceIds.has(id)) throw new Error('IDs repetidos no backup de ' + label(key) + '.');
        sourceIds.add(id);
        if (!ids.has(id)) { ids.set(id, rows.length); rows.push(record); }
        else if (!equal(rows[ids.get(id)], record)) rows[ids.get(id)] = choose(key, id, rows[ids.get(id)], record);
      }
      merged[key] = rows;
    }
  }
  return { merged, conflicts };
}
export function changes(remoteRows, values) {
  const rows = new Map(remoteRows.map(row => [row.chave, row]));
  return Object.entries(values).filter(([key, value]) => !equal(rows.get(key)?.valor, value))
    .map(([key, value]) => ({ chave: key, valor: validateValue(key, value), versao: rows.get(key)?.versao || 0 }));
}
export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
