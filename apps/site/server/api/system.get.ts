import { defineEventHandler } from "h3";
import { readSystemStatus } from "../utils/systemStatus.ts";

export default defineEventHandler(() => readSystemStatus());
