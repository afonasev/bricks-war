export interface SoloRecord {
  id: string;
  name: string;
  elapsedMs: number;
  lineScore: number;
  finishedAt: number | null;
  placedPieces: number | null;
  /** Kept for backwards-compatible consumers; Survival ranking never uses it. */
  total: number;
}

export type SurvivalAttempt = Omit<SoloRecord, 'id' | 'total' | 'finishedAt' | 'placedPieces'> & Partial<Pick<SoloRecord, 'id' | 'total' | 'finishedAt' | 'placedPieces'>>;
export const SOLO_RECORDS_STORAGE_KEY = 'bricks-war:solo-records:v1';
export type RecordStorage = Pick<Storage, 'getItem' | 'setItem'>;

const storage = (): RecordStorage | null => { try { return window.localStorage; } catch { return null; } };

function recordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `survival-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseRecord(value: unknown, index: number): SoloRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<SoloRecord>;
  if (typeof record.name !== 'string' || !Number.isFinite(record.elapsedMs) || !Number.isFinite(record.lineScore)) return null;
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : `legacy-${index}-${record.name}-${record.elapsedMs}-${record.lineScore}`;
  return {
    id, name: record.name, elapsedMs: record.elapsedMs!, lineScore: record.lineScore!, total: record.lineScore!,
    finishedAt: Number.isFinite(record.finishedAt) ? record.finishedAt as number : null,
    placedPieces: Number.isFinite(record.placedPieces) ? record.placedPieces as number : null,
  };
}

function sortRecords(records: readonly SoloRecord[]): SoloRecord[] {
  return records.map((record, index) => ({ record, index }))
    .sort((left, right) => right.record.lineScore - left.record.lineScore || left.index - right.index)
    .map(({ record }) => record)
    .slice(0, 10);
}

export function loadSoloRecords(readStorage: Pick<RecordStorage, 'getItem'> | null = storage()): SoloRecord[] {
  try {
    const parsed = JSON.parse(readStorage?.getItem(SOLO_RECORDS_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? sortRecords(parsed.flatMap((record, index) => {
      const parsedRecord = parseRecord(record, index);
      return parsedRecord ? [parsedRecord] : [];
    })) : [];
  } catch { return []; }
}

export interface SaveSurvivalRecordsResult {
  records: SoloRecord[];
  rankedIds: string[];
  unranked: SoloRecord[];
}

export function saveSurvivalRecords(attempts: readonly SurvivalAttempt[], writeStorage: RecordStorage | null = storage()): SaveSurvivalRecordsResult {
  const current = attempts.map((attempt) => ({
    id: attempt.id && attempt.id.length > 0 ? attempt.id : recordId(),
    name: attempt.name,
    elapsedMs: attempt.elapsedMs,
    lineScore: attempt.lineScore,
    total: attempt.lineScore,
    finishedAt: Number.isFinite(attempt.finishedAt) ? attempt.finishedAt as number : Date.now(),
    placedPieces: Number.isFinite(attempt.placedPieces) ? attempt.placedPieces as number : null,
  }));
  const records = sortRecords([...loadSoloRecords(writeStorage), ...current]);
  const retained = new Set(records.map((record) => record.id));
  try { writeStorage?.setItem(SOLO_RECORDS_STORAGE_KEY, JSON.stringify(records)); } catch { /* non-fatal */ }
  return { records, rankedIds: current.filter((record) => retained.has(record.id)).map((record) => record.id), unranked: current.filter((record) => !retained.has(record.id)) };
}

export function saveSoloRecord(record: SurvivalAttempt, writeStorage: RecordStorage | null = storage()): { records: SoloRecord[]; ranked: boolean } {
  const saved = saveSurvivalRecords([record], writeStorage);
  return { records: saved.records, ranked: saved.rankedIds.length === 1 };
}
