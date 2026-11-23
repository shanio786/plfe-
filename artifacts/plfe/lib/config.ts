import dotenv from "dotenv";
import path from "node:path";
dotenv.config({path: [path.resolve(process.cwd(), ".env"),path.resolve(process.cwd(), "../../.env")],quiet:true});
function positive(name:string, fallback:number) {
  const n = Number(process.env[name] ?? fallback);
  if(!Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid ${name}`);
  return n;
}
export const config = {
  databaseUrl: process.env.PLFE_DATABASE_URL || process.env.DATABASE_URL,
  appUrl: process.env.APP_URL,
  accountingTimezone: process.env.ACCOUNTING_TIMEZONE || "Asia/Karachi",
  cookieName: process.env.SESSION_COOKIE_NAME || "__Host-plfe-session",
  passwordMinLength: positive("PASSWORD_MIN_LENGTH",10),
  bcryptRounds: positive("BCRYPT_ROUNDS",12),
  maxFailedLogins: positive("LOGIN_MAX_FAILURES",5),
  lockMinutes: positive("LOGIN_LOCK_MINUTES",15),
  idleMinutes: positive("SESSION_IDLE_MINUTES",240),
  maxSessionMinutes: positive("SESSION_MAX_MINUTES",840),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "./var/uploads"),
  maxUploadBytes: positive("MAX_UPLOAD_BYTES",10485760),
  allowedMime: (process.env.UPLOAD_ALLOWED_MIME || "application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain").split(","),
  workerCron: process.env.WORKER_CLEANUP_CRON || "*/15 * * * *",
};
