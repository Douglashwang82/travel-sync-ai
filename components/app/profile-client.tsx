"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { clearAppBrowserCache } from "@/lib/app-browser-cache";
import { getIntlLocale, type AppLocale } from "@/lib/app-locale";

export interface ProfileInitial {
  appUserId: string;
  lineUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  groupCount: number;
  tripCount: number;
}

const COPY: Record<
  AppLocale,
  {
    heading: string;
    subheading: string;
    accountSection: string;
    identifiersSection: string;
    statsSection: string;
    dangerSection: string;
    displayName: string;
    displayNamePlaceholder: string;
    avatarUrl: string;
    avatarUrlPlaceholder: string;
    avatarHelp: string;
    email: string;
    emailNotSet: string;
    lineUserId: string;
    memberSince: string;
    groups: (n: number) => string;
    trips: (n: number) => string;
    save: string;
    saving: string;
    saved: string;
    saveFailed: string;
    deleteHeading: string;
    deleteBody: string;
    deleteConfirmLabel: string;
    deleteConfirmPhrase: string;
    deleteButton: string;
    deleting: string;
    deleteFailed: string;
    deleteSuccess: string;
  }
> = {
  en: {
    heading: "Your profile",
    subheading: "Update how your name shows up across trips and groups.",
    accountSection: "Account",
    identifiersSection: "Identifiers",
    statsSection: "Activity",
    dangerSection: "Delete account",
    displayName: "Display name",
    displayNamePlaceholder: "How should we call you?",
    avatarUrl: "Avatar URL",
    avatarUrlPlaceholder: "https://...",
    avatarHelp: "Paste a public image URL. Leave blank to use initials.",
    email: "Email",
    emailNotSet: "No email on file",
    lineUserId: "LINE user ID",
    memberSince: "Member since",
    groups: (n) => `${n} group${n === 1 ? "" : "s"}`,
    trips: (n) => `${n} trip${n === 1 ? "" : "s"}`,
    save: "Save changes",
    saving: "Saving...",
    saved: "Saved",
    saveFailed: "Could not save profile.",
    deleteHeading: "Delete all personal data",
    deleteBody:
      "This removes your display name, packing list, documents, and other personal records across every group and trip. Anonymised expense rows are retained to preserve group balances. This cannot be undone.",
    deleteConfirmLabel: "Type DELETE MY DATA to confirm",
    deleteConfirmPhrase: "DELETE MY DATA",
    deleteButton: "Delete my data",
    deleting: "Deleting...",
    deleteFailed: "Deletion failed. Please try again.",
    deleteSuccess: "Your data has been removed. Signing you out…",
  },
  "zh-TW": {
    heading: "個人檔案",
    subheading: "更新你在旅程與群組中顯示的名稱與頭像。",
    accountSection: "帳戶資料",
    identifiersSection: "識別資訊",
    statsSection: "活動",
    dangerSection: "刪除帳戶",
    displayName: "顯示名稱",
    displayNamePlaceholder: "你希望大家怎麼稱呼你？",
    avatarUrl: "頭像網址",
    avatarUrlPlaceholder: "https://...",
    avatarHelp: "貼上公開可存取的圖片網址，留空則顯示縮寫。",
    email: "電子郵件",
    emailNotSet: "尚未設定電子郵件",
    lineUserId: "LINE 使用者 ID",
    memberSince: "加入時間",
    groups: (n) => `${n} 個群組`,
    trips: (n) => `${n} 個旅程`,
    save: "儲存變更",
    saving: "儲存中...",
    saved: "已儲存",
    saveFailed: "無法儲存個人檔案。",
    deleteHeading: "刪除所有個人資料",
    deleteBody:
      "這將會從所有群組與旅程中移除你的顯示名稱、打包清單、文件與其他個人記錄。已匿名化的費用記錄會保留以維持群組分帳平衡。此操作無法復原。",
    deleteConfirmLabel: "輸入 DELETE MY DATA 以確認",
    deleteConfirmPhrase: "DELETE MY DATA",
    deleteButton: "刪除我的資料",
    deleting: "刪除中...",
    deleteFailed: "刪除失敗，請再試一次。",
    deleteSuccess: "你的資料已刪除，正在登出…",
  },
};

function initialsFor(name: string | null, fallback: string): string {
  const base = (name ?? fallback ?? "?").trim();
  if (!base) return "?";
  const parts = base.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || base[0]?.toUpperCase() || "?";
}

function formatDate(iso: string, locale: AppLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(getIntlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ProfileClient({ initial }: { initial: ProfileInitial }) {
  const router = useRouter();
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  const [profile, setProfile] = useState<ProfileInitial>(initial);
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  const dirty =
    displayName.trim() !== (profile.displayName ?? "") ||
    avatarUrl.trim() !== (profile.avatarUrl ?? "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setSaveStatus("idle");
    setSaveError(null);
    try {
      const trimmedName = displayName.trim();
      const trimmedAvatar = avatarUrl.trim();
      const next = await appFetchJson<{
        displayName: string | null;
        avatarUrl: string | null;
        updatedAt: string;
      }>("/api/app/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: trimmedName.length === 0 ? null : trimmedName,
          avatarUrl: trimmedAvatar,
        }),
      });
      setProfile((prev) => ({
        ...prev,
        displayName: next.displayName,
        avatarUrl: next.avatarUrl,
        updatedAt: next.updatedAt,
      }));
      setDisplayName(next.displayName ?? "");
      setAvatarUrl(next.avatarUrl ?? "");
      setSaveStatus("saved");
      router.refresh();
    } catch (err) {
      setSaveStatus("error");
      setSaveError(
        err instanceof AppApiFetchError
          ? err.message
          : copy.saveFailed
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (deletePhrase !== copy.deleteConfirmPhrase || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/user/delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.lineUserId,
          confirmPhrase: copy.deleteConfirmPhrase,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? copy.deleteFailed);
      }
      setDeleteSuccess(true);
      clearAppBrowserCache();
      await fetch("/api/app/sign-in", { method: "DELETE", credentials: "include" });
      setTimeout(() => {
        router.push("/app/sign-in");
        router.refresh();
      }, 1200);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : copy.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  const initials = initialsFor(displayName || profile.displayName, profile.lineUserId);
  const showAvatar = /^https?:\/\//i.test(avatarUrl.trim());

  return (
    <div id="profile-page" className="mx-auto w-full max-w-3xl space-y-8">
      <header id="profile-header" className="space-y-1">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{copy.heading}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{copy.subheading}</p>
      </header>

      <section
        id="profile-account"
        className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {copy.accountSection}
        </h2>

        <div className="mb-6 flex items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--secondary)]">
            {showAvatar ? (
              <Image
                src={avatarUrl.trim()}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-[var(--muted-foreground)]">
                {initials}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-[var(--foreground)]">
              {profile.displayName ?? profile.lineUserId}
            </p>
            <p className="truncate text-xs text-[var(--muted-foreground)]">
              {profile.email ?? copy.emailNotSet}
            </p>
          </div>
        </div>

        <form id="profile-form" onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-display-name">{copy.displayName}</Label>
            <Input
              id="profile-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={copy.displayNamePlaceholder}
              maxLength={80}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-avatar-url">{copy.avatarUrl}</Label>
            <Input
              id="profile-avatar-url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder={copy.avatarUrlPlaceholder}
              type="url"
              inputMode="url"
              maxLength={2048}
            />
            <p className="text-[11px] text-[var(--muted-foreground)]">{copy.avatarHelp}</p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={!dirty || saving} className="rounded-full">
              {saving ? copy.saving : copy.save}
            </Button>
            {saveStatus === "saved" && !dirty && (
              <span className="text-xs text-[var(--muted-foreground)]">{copy.saved}</span>
            )}
            {saveStatus === "error" && saveError && (
              <span className="text-xs text-red-600">{saveError}</span>
            )}
          </div>
        </form>
      </section>

      <section
        id="profile-identifiers"
        className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {copy.identifiersSection}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={copy.email} value={profile.email ?? copy.emailNotSet} mono={Boolean(profile.email)} />
          <Field label={copy.lineUserId} value={profile.lineUserId} mono />
          <Field label={copy.memberSince} value={formatDate(profile.createdAt, locale)} />
        </dl>
      </section>

      <section
        id="profile-stats"
        className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {copy.statsSection}
        </h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-[var(--secondary)] px-3 py-1 text-[var(--foreground)]">
            {copy.groups(profile.groupCount)}
          </span>
          <span className="rounded-full bg-[var(--secondary)] px-3 py-1 text-[var(--foreground)]">
            {copy.trips(profile.tripCount)}
          </span>
        </div>
      </section>

      <section
        id="profile-danger"
        className="rounded-2xl border border-red-300/60 bg-red-50/40 p-6 dark:border-red-900/40 dark:bg-red-950/20"
      >
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
          {copy.dangerSection}
        </h2>
        <p className="mb-4 text-sm font-semibold text-[var(--foreground)]">{copy.deleteHeading}</p>
        <p className="mb-4 text-xs leading-relaxed text-[var(--muted-foreground)]">
          {copy.deleteBody}
        </p>
        <form onSubmit={handleDelete} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="profile-delete-confirm">{copy.deleteConfirmLabel}</Label>
            <Input
              id="profile-delete-confirm"
              value={deletePhrase}
              onChange={(e) => setDeletePhrase(e.target.value)}
              placeholder={copy.deleteConfirmPhrase}
              autoComplete="off"
              disabled={deleting || deleteSuccess}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="destructive"
              disabled={
                deletePhrase !== copy.deleteConfirmPhrase || deleting || deleteSuccess
              }
              className="rounded-full"
            >
              {deleting ? copy.deleting : copy.deleteButton}
            </Button>
            {deleteSuccess && (
              <span className="text-xs text-[var(--muted-foreground)]">
                {copy.deleteSuccess}
              </span>
            )}
            {deleteError && !deleteSuccess && (
              <span className="text-xs text-red-600">{deleteError}</span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd
        className={`break-all text-sm text-[var(--foreground)] ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
