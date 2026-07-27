import ConsultStart from "@/components/ConsultStart";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function ConsultStartPage() {
  if (!getCurrentUserId()) redirect("/login?next=/consult/start");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <ConsultStart />
    </main>
  );
}
