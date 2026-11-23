import Decimal from "decimal.js";
import {Prisma} from "@prisma/client";
export function money(value:string|Prisma.Decimal) {
  const result = new Decimal(value.toString());
  if(!result.isFinite() || result.decimalPlaces()>4 || result.abs().gte("100000000000000")) throw new Error("Invalid monetary amount");
  return new Prisma.Decimal(result.toFixed(4));
}
