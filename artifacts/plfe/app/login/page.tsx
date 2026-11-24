import { LoginScreen } from "@/modules/core/components/auth";
import Link from "next/link";

export default function Page() {
  return <><LoginScreen /><div className="fixed bottom-4 w-full text-center text-xs"><Link href="/enroll">First-run Owner enrollment</Link></div></>;
}
