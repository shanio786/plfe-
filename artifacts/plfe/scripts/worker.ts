import cron from "node-cron";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {audit} from "../lib/audit";
const job=cron.schedule(config.workerCron,async()=>{
  try {
    await db.$transaction(async tx=>{
      const expired=await tx.session.findMany({where:{OR:[{expiresAt:{lt:new Date()}},{lastSeenAt:{lt:new Date(Date.now()-config.idleMinutes*60000)}}]},take:1000,select:{id:true}});
      if(expired.length) {
        await tx.session.deleteMany({where:{id:{in:expired.map(s=>s.id)}}});
        await audit(tx,null,null,"SYSTEM","sessions",null,null,{event:"Expired sessions removed",count:expired.length});
      }
    });
  } catch {process.stderr.write("Session cleanup failed; will retry on the next scheduled run.\n");}
});
async function stop(){await job.stop();await db.$disconnect();process.exit(0);}
process.on("SIGTERM",stop);process.on("SIGINT",stop);
process.stdout.write("Foundation worker started.\n");
