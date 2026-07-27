import { Suspense } from "react";
import AuthCallback from "@/components/AuthCallback";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallback />
    </Suspense>
  );
}
