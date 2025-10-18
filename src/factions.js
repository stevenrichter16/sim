export const FACTIONS = [
  {
    id: 0,
    key: 'A',
    color: '#00c8ff',
    outline: '#48e4ff',
    safeFieldColor: '#00c8ff',
    safeDeposit: 0.03,
    safePhaseBucket: 0,
    affinity: { B: -1 },
  },
  {
    id: 1,
    key: 'B',
    color: '#48ff7b',
    outline: '#8Bff9f',
    safeFieldColor: '#48ff7b',
    safeDeposit: 0.03,
    safePhaseBucket: 2,
    affinity: { A: -1 },
  },
  {
    id: 2,
    key: 'C',
    color: '#ff9cf0',
    outline: '#ffc6ff',
    safeFieldColor: '#ff9cf0',
    safeDeposit: 0.03,
    safePhaseBucket: 4,
    affinity: { A: 0.3, B: -0.5 },
  },
];

export const DEFAULT_FACTION_ID = 0;

export function factionById(id){
  return FACTIONS[id] || FACTIONS[DEFAULT_FACTION_ID];
}

export function factionByKey(key){
  const found = FACTIONS.find(f => f.key === key);
  return found || FACTIONS[DEFAULT_FACTION_ID];
}

export function factionAffinity(aId, bId){
  if(aId === bId) return 1;
  const a = factionById(aId);
  const b = factionById(bId);
  const key = b.key;
  if(a.affinity && typeof a.affinity[key] === 'number') return a.affinity[key];
  return 0;
}
