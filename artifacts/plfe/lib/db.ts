import {PrismaClient} from "@prisma/client";
import {config} from "./config";
const globalDb = globalThis as unknown as {plfeDb?:PrismaClient};
export const db = globalDb.plfeDb ?? new PrismaClient({
  ...(config.databaseUrl ? {datasourceUrl:config.databaseUrl} : {}),
  // Error objects can contain SQL parameters; route logs use safe codes only.
  log: []
});
if(process.env.NODE_ENV !== "production") globalDb.plfeDb = db;
export type {Prisma} from "@prisma/client";
