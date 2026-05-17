// Path:    src/lib/rateLimit.ts
// Purpose: In-memory rate limiter for API endpoints.
//          Resets on cold start — acceptable for low-traffic alerting.
// Used by: src/app/api/receive/route.ts

type RateLimitEntry = {
  count:   number;
  resetAt: number;
};

// Per-endpoint rate limit maps
const maps = new Map<string, Map<string, RateLimitEntry>>();

function getMap(endpoint: string): Map<string, RateLimitEntry> {
  if (!maps.has(endpoint)) maps.set(endpoint, new Map());
  return maps.get(endpoint)!;
}

type RateLimitConfig = {
  /** Max allowed calls per window */
  max:      number;
  /** Window duration in ms */
  windowMs: number;
};

type RateLimitResult = {
  allowed:   boolean;
  remaining: number;
  resetAt:   number;
};

/**
 * Checks and increments the rate limit counter for a given key.
 *
 * @param endpoint - Unique name for the endpoint/bucket
 * @param key      - Client identifier (IP address, etc.)
 * @param config   - max and windowMs
 */
export function checkRateLimit(
  endpoint: string,
  key:      string,
  config:   RateLimitConfig,
): RateLimitResult {
  const map = getMap(endpoint);
  const now = Date.now();

  let entry = map.get(key);

  // Reset expired window
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + config.windowMs };
    map.set(key, entry);
  }

  if (entry.count >= config.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed:   true,
    remaining: config.max - entry.count,
    resetAt:   entry.resetAt,
  };
}