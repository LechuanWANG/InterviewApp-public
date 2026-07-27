import LoadingIndicator from "@/components/LoadingIndicator";

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <LoadingIndicator size="lg" />
    </div>
  );
}
