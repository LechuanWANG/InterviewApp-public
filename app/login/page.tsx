import { Suspense } from "react";
import AuthLogin from "@/components/AuthLogin";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthLogin />
    </Suspense>
  );
}
