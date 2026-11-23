import {config} from "@/lib/config";
import {dateOnly} from "./model";
export function accountingToday() {
  return dateOnly(new Intl.DateTimeFormat("en-CA",{timeZone:config.accountingTimezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
}
