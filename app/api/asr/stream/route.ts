import { handleCloudflareAsrStream } from "@/lib/voice/cloudflareAsrStream";

export async function GET(req: Request) {
  return handleCloudflareAsrStream(req, process.env);
}
