interface CacheEntry {
  points: number[][];
  colors?: number[][];
  timestamp: number;
}

const pointCloudCache = new Map<string, CacheEntry>();
const CACHE_MAX_SIZE = 10;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of pointCloudCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      pointCloudCache.delete(key);
    }
  }
}

export function addToCache(scanId: string, points: number[][], colors?: number[][]) {
  cleanExpiredCache();
  if (pointCloudCache.size >= CACHE_MAX_SIZE) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [key, entry] of pointCloudCache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    if (oldestKey) pointCloudCache.delete(oldestKey);
  }
  pointCloudCache.set(scanId, { points, colors, timestamp: Date.now() });
}

export function getFromCache(scanId: string): CacheEntry | undefined {
  const entry = pointCloudCache.get(scanId);
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL_MS) {
    return entry;
  }
  if (entry) pointCloudCache.delete(scanId);
  return undefined;
}
