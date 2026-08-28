export function readOptionalNumberEnv(key: string): number | undefined {
  const value = process.env[key];

  if (!value) {
    return undefined;
  }

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) {
    throw new Error(`${key} 必须是有效数字。`);
  }

  return numberValue;
}
