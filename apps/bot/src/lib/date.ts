import dayjs from "dayjs";

export function dateFormat(timestamp: number) {
  return dayjs(timestamp).format("YYYY/MM/DD HH:mm:ss");
}