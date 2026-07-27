import GroupCouncilPage from "@/components/GroupCouncilPage";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function GroupCouncilRoutePage() {
  if (!getCurrentUserId()) redirect("/login?next=/interview/new");
  return <GroupCouncilPage />;
}
