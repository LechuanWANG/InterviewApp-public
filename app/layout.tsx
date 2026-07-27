import "./globals.css";
import type { Metadata } from "next";
import { LanguageProvider } from "@/components/LanguageProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import AuthControl from "@/components/AuthControl";
import {
  getRuntimePublicSupabaseEnv,
  PUBLIC_SUPABASE_ENV_GLOBAL,
  serializePublicSupabaseEnv,
} from "@/lib/publicSupabaseEnv";

export const metadata: Metadata = {
  title: "AI 模拟面试",
  description: "上传简历 + JD，AI 帮你模拟面试并给出反馈",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const publicSupabaseEnv = getRuntimePublicSupabaseEnv();

  return (
    <html lang="zh">
      <body className="bg-slate-50 min-h-screen text-slate-900">
        {publicSupabaseEnv && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.${PUBLIC_SUPABASE_ENV_GLOBAL}=${serializePublicSupabaseEnv(publicSupabaseEnv)};`,
            }}
          />
        )}
        <LanguageProvider>
          <AuthControl />
          <LanguageSwitcher />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
