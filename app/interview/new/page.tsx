import CreateForm from "@/components/CreateForm";
import BackButton from "@/components/BackButton";
import NewInterviewHeader from "@/components/NewInterviewHeader";
import { getCurrentUserId } from "@/lib/auth";
import { redirect } from "next/navigation";

export default function NewInterviewPage() {
  if (!getCurrentUserId()) redirect("/login?next=/interview/new");

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <div className="space-y-8">
        <div className="sticky top-3 z-40 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <NewInterviewHeader />
            <div className="flex flex-wrap items-center gap-2">
              <BackButton fallbackHref="/interview/choose" alwaysFallback />
            </div>
          </div>
        </div>
        <CreateForm />
      </div>
    </main>
  );
}
