/** 按点号路径或数组路径向对象深层赋值，缺少的中间对象会被创建。 */
export function setDeepPath(
  target: Record<string | number, unknown>,
  path: string | readonly (string | number)[],
  value: unknown,
): void {
  const segments = typeof path === "string" ? path.split(".").filter(Boolean) : path;

  if (segments.length === 0) {
    throw new Error("路径不能为空。");
  }

  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string | number, unknown>;
  }

  current[segments.at(-1)!] = value;
}
