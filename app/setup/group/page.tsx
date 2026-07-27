import GroupSetupFlow from "@/components/GroupSetupFlow";
import BackButton from "@/components/BackButton";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function GroupSetupPage() {
  if (!getCurrentUserId()) redirect("/login?next=/setup/group");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <GroupSetupFlow headerAction={<BackButton fallbackHref="/interview/new" />} />
    </main>
  );
}
