export const FACTIONS = [
  {
    id: 0,
    key: 'A',
    color: '#00c8ff',
    outline: '#48e4ff',
    safeFieldColor: '#00c8ff',
    safeDeposit: 0.03,
    safePhaseBucket: 0,
  },
  {
    id: 1,
    key: 'B',
    color: '#48ff7b',
    outline: '#8Bff9f',
    safeFieldColor: '#48ff7b',
    safeDeposit: 0.03,
    safePhaseBucket: 2,
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
