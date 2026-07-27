import SetupFlow from "@/components/SetupFlow";
import BackButton from "@/components/BackButton";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function SetupPage() {
  if (!getCurrentUserId()) redirect("/login?next=/setup");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <SetupFlow headerAction={<BackButton fallbackHref="/interview/new" />} />
    </main>
  );
}
