import { RADIO_BASE, loadPlays } from '../radio/radio-data';
import type { Play, RadioRecord } from '../radio/radio-data';

export const RELEASE_HOME = `/base/${RADIO_BASE}/releases`;
export interface Release {
  id: string;
  title: string;
  artist_id: string | null;
  artist: string | null;
  release_date: string | null;
  format: string | null;
  status: string | null;
  delivery_status: string | null;
  upc_ean: string | null;
  has_cover: boolean;
  release_ready: boolean | null;
  release_missing: string | null;
  updated_at: string | null;
  parent_release_id: string | null;
}
export interface Track {
  id: string;
  title: string;
  release_id: string;
  position: number | null;
  version: string | null;
  isrc: string | null;
  has_audio: boolean;
  track_ready: boolean | null;
  track_missing: string | null;
  clearance_progress: number | null;
  updated_at: string | null;
}
export interface Milestone {
  id: string;
  release_id: string;
  title: string;
  phase: string | null;
  due_date: string | null;
  status: string;
  is_blocking: boolean;
}
export interface Campaign {
  id: string;
  release_id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  main_platform: string | null;
}
export interface WorkspaceData {
  releases: Release[];
  tracks: Track[];
  milestones: Milestone[];
  campaigns: Campaign[];
  refreshedAt: string;
  sourceOrigin: string;
}
export const isTestRelease = (r: Release) => /^QA\s*[—–-]/i.test(r.title);
export const normalizeIsrc = (s: string | null) => (s || '').replace(/[-\s]/g, '').toUpperCase();
export function defaultRelease(releases: Release[], today: string) {
  const future = releases
    .filter((r) => r.release_date && r.release_date >= today)
    .sort((a, b) => a.release_date!.localeCompare(b.release_date!));
  return future[0]?.id || releases[0]?.id || '';
}
export function matchRadio(tracks: Track[], catalog: RadioRecord[], plays: Play[]) {
  const byIsrc = new Map<string, Set<string>>();
  for (const r of catalog) {
    const id = String(r.fields.Track_ID || '');
    for (const raw of String(r.fields.ISRCs || '').split(/[,;\n]+/)) {
      const isrc = normalizeIsrc(raw);
      if (!isrc || !id) continue;
      const ids = byIsrc.get(isrc) || new Set<string>();
      ids.add(id);
      byIsrc.set(isrc, ids);
    }
  }
  const ids = new Set<string>();
  let matched = 0;
  let ambiguous = 0;
  for (const track of tracks) {
    const candidates = byIsrc.get(normalizeIsrc(track.isrc));
    if (candidates?.size === 1) {
      matched++;
      ids.add([...candidates][0]);
    } else if (candidates && candidates.size > 1) ambiguous++;
  }
  return { matched, ambiguous, plays: plays.filter((p) => ids.has(p.trackId)) };
}
export async function loadRadioCatalog(signal: AbortSignal) {
  const records: RadioRecord[] = [];
  for (let skip = 0; skip < 100000; skip += 1000) {
    const params = new URLSearchParams({ take: '1000', skip: String(skip), fieldKeyType: 'name' });
    ['Track_ID', 'ISRCs'].forEach((f) => params.append('projection[]', f));
    const response = await fetch(`/api/table/tblpxYFp8SJBeKHv9sj/record?${params}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Radio data could not be loaded.');
    const data = await response.json();
    if (!Array.isArray(data.records)) throw new Error('Radio data could not be loaded.');
    records.push(...data.records);
    if (data.records.length < 1000) return { catalog: records, ...(await loadPlays(signal)) };
  }
  throw new Error('Radio catalogue is too large. No partial totals are shown.');
}
