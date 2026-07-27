import { Suspense } from "react";
import HomePageContent from "@/components/HomePageContent";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#02060f]" />}>
      <HomePageContent />
    </Suspense>
  );
}
