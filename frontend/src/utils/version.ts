/**
 * 按点分段的版本号做数值比较。
 * 缺失的段按 0 处理（例如 "5" == "5.0" == "5.0.0"）。
 *
 * 返回值：
 *   a > b 时为正数
 *   a < b 时为负数
 *   a == b 时为 0
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((s) => parseInt(s, 10) || 0);
  const partsB = b.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

/** 当 latest 严格新于 current 时返回 true。 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
