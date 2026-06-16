"use client";

import { format } from "date-fns";
import type { User } from "@supabase/supabase-js";
import {
  CalendarDays,
  Check,
  Download,
  LayoutDashboard,
  LogIn,
  LogOut,
  Save,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMonthDates, getWeekday, monthKey, toDateKey, weekdayLabels } from "@/lib/date-utils";
import { downloadShiftWorkbook } from "@/lib/excel";
import { getJapaneseHolidayName, isClosedDay } from "@/lib/holidays";
import { defaultRequiredByWeekday, initialRequests, initialRequiredStaff, initialStaff } from "@/lib/sample-data";
import { generateShift, getShiftStats } from "@/lib/schedule";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  deleteStaff as deleteSupabaseStaff,
  deleteTimeOffRequest,
  loadSupabaseStore,
  replaceMonthAssignments,
  upsertRequiredStaff,
  upsertStaff,
  upsertTimeOffRequest,
} from "@/lib/supabase-store";
import type { RequiredStaff, ShiftAssignment, Staff, TimeOffRequest, Weekday } from "@/lib/types";

const weekdays: Weekday[] = [1, 2, 3, 4, 5];
const tabs = ["dashboard", "staff", "required", "requests", "shift"] as const;
type AdminTab = (typeof tabs)[number];
type UserRole = "admin" | "staff";

function getDefaultRequired(date: Date) {
  return isClosedDay(date) ? 0 : defaultRequiredByWeekday[getWeekday(date)] ?? 0;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getUserRole(user: User | null): UserRole {
  return user?.app_metadata?.role === "admin" ? "admin" : "staff";
}

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const isSupabaseEnabled = Boolean(supabase);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authRole, setAuthRole] = useState<UserRole>("staff");
  const [isAuthReady, setIsAuthReady] = useState(!supabase);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [mode, setMode] = useState<"staff" | "admin">("staff");
  const [adminTab, setAdminTab] = useState<AdminTab>("dashboard");
  const [targetMonth, setTargetMonth] = useState(monthKey(new Date()));
  const [staff, setStaff] = useState<Staff[]>(initialStaff);
  const [activeStaffId, setActiveStaffId] = useState(initialStaff[0]?.id ?? "");
  const [requests, setRequests] = useState<TimeOffRequest[]>(initialRequests);
  const [required, setRequired] = useState<RequiredStaff>(initialRequiredStaff);
  const [assignments, setAssignments] = useState<ShiftAssignment>({});
  const [dragStaffId, setDragStaffId] = useState<string | null>(null);
  const [bulkValue, setBulkValue] = useState(3);
  const [bulkWeekdays, setBulkWeekdays] = useState<Weekday[]>([1, 2, 3, 4, 5]);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const canAdmin = !isSupabaseEnabled || authRole === "admin";

  const monthDates = useMemo(() => getMonthDates(targetMonth), [targetMonth]);
  const activeStaff = staff.find((member) => member.id === activeStaffId) ?? staff[0];
  const monthRequests = requests.filter((request) => request.date.startsWith(targetMonth));
  const shiftIssues = useMemo(() => {
    return monthDates
      .filter((date) => !isClosedDay(date))
      .map((date) => {
        const key = toDateKey(date);
        const requiredCount = required[key] ?? getDefaultRequired(date);
        const assigned = assignments[key]?.length ?? 0;
        return { date: key, required: requiredCount, assigned };
      })
      .filter((issue) => issue.assigned < issue.required);
  }, [assignments, monthDates, required]);

  const submittedStaffIds = new Set(monthRequests.map((request) => request.staffId));
  const stats = getShiftStats(assignments, staff);

  const runSupabaseAction = useCallback(
    async (action: () => Promise<void>) => {
      if (!supabase) return;
      setIsSaving(true);
      setErrorMessage("");
      try {
        await action();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Supabaseへの保存に失敗しました。");
      } finally {
        setIsSaving(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErrorMessage(error.message);
        const user = data.session?.user ?? null;
        const role = getUserRole(user);
        setAuthUser(user);
        setAuthRole(role);
        if (user && role === "admin") setMode("admin");
        setIsAuthReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "ログイン状態を確認できませんでした。");
        setIsAuthReady(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      const role = getUserRole(user);
      setAuthUser(user);
      setAuthRole(role);
      setIsAuthReady(true);
      setErrorMessage("");
      if (user && role === "admin") setMode("admin");
      if (!user) {
        setMode("staff");
        setStaff(initialStaff);
        setActiveStaffId(initialStaff[0]?.id ?? "");
        setRequests(initialRequests);
        setRequired(initialRequiredStaff);
        setAssignments({});
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !authUser || !isAuthReady) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoading(true);
      setErrorMessage("");
    });

    const scope = authRole === "admin" ? { role: "admin" as const } : { role: "staff" as const, userId: authUser.id };
    if (authRole === "staff") {
      queueMicrotask(() => setMode("staff"));
    }

    loadSupabaseStore(supabase, targetMonth, scope)
      .then((store) => {
        if (cancelled) return;
        setStaff(store.staff);
        setRequests(store.requests);
        setRequired(store.required);
        setAssignments(store.assignments);
        setActiveStaffId((current) => (store.staff.some((member) => member.id === current) ? current : (store.staff[0]?.id ?? "")));
        if (authRole === "staff" && store.staff.length === 0) {
          setErrorMessage("ログイン中のユーザーに紐づくスタッフ情報がありません。管理者に staff.auth_user_id の設定を依頼してください。");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Supabaseからデータを取得できませんでした。");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authRole, authUser, isAuthReady, supabase, targetMonth]);

  function toggleRequest(dateKey: string) {
    if (!activeStaff) return;
    if (isSupabaseEnabled && authRole === "staff" && activeStaff.authUserId !== authUser?.id) {
      setErrorMessage("自分以外の希望休は編集できません。");
      return;
    }
    const exists = requests.find((request) => request.staffId === activeStaff.id && request.date === dateKey);
    if (exists) {
      setRequests((current) => current.filter((request) => request !== exists));
      void runSupabaseAction(() => deleteTimeOffRequest(supabase!, activeStaff.id, dateKey));
      return;
    }
    const request = { staffId: activeStaff.id, date: dateKey, memo: "", submittedAt: new Date().toISOString() };
    setRequests((current) => [
      ...current,
      request,
    ]);
    void runSupabaseAction(() => upsertTimeOffRequest(supabase!, request));
  }

  function updateMemo(dateKey: string, memo: string) {
    if (!activeStaff) return;
    if (isSupabaseEnabled && authRole === "staff" && activeStaff.authUserId !== authUser?.id) {
      setErrorMessage("自分以外の希望休は編集できません。");
      return;
    }
    const nextRequest = requests.find((request) => request.staffId === activeStaff.id && request.date === dateKey);
    setRequests((current) =>
      current.map((request) =>
        request.staffId === activeStaff.id && request.date === dateKey ? { ...request, memo } : request,
      ),
    );
    if (nextRequest) {
      void runSupabaseAction(() => upsertTimeOffRequest(supabase!, { ...nextRequest, memo }));
    }
  }

  function applyBulkRequired() {
    if (!canAdmin) {
      setErrorMessage("管理者のみ必要人数を編集できます。");
      return;
    }
    let nextRequired: RequiredStaff = {};
    setRequired((current) => {
      const next = { ...current };
      for (const date of monthDates) {
        if (!bulkWeekdays.includes(getWeekday(date)) || isClosedDay(date)) continue;
        next[toDateKey(date)] = bulkValue;
      }
      nextRequired = next;
      return next;
    });
    void runSupabaseAction(() => upsertRequiredStaff(supabase!, nextRequired));
  }

  function createShift() {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを自動作成できます。");
      return;
    }
    const filledRequired = monthDates.reduce<RequiredStaff>((acc, date) => {
      acc[toDateKey(date)] = required[toDateKey(date)] ?? getDefaultRequired(date);
      return acc;
    }, {});
    const result = generateShift(targetMonth, staff, monthRequests, filledRequired);
    setAssignments(result.assignments);
    setAdminTab("shift");
    void runSupabaseAction(async () => {
      await upsertRequiredStaff(supabase!, filledRequired);
      await replaceMonthAssignments(supabase!, targetMonth, result.assignments);
    });
  }

  function toggleAssignment(dateKey: string, staffId: string) {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを編集できます。");
      return;
    }
    let nextAssignments: ShiftAssignment = {};
    setAssignments((current) => {
      const selected = new Set(current[dateKey] ?? []);
      if (selected.has(staffId)) selected.delete(staffId);
      else selected.add(staffId);
      nextAssignments = { ...current, [dateKey]: [...selected] };
      return nextAssignments;
    });
    void runSupabaseAction(() => replaceMonthAssignments(supabase!, targetMonth, nextAssignments));
  }

  function moveDraggedStaff(dateKey: string) {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを編集できます。");
      return;
    }
    if (!dragStaffId || isClosedDay(new Date(dateKey))) return;
    let nextAssignments: ShiftAssignment = {};
    setAssignments((current) => {
      const next: ShiftAssignment = {};
      for (const [key, ids] of Object.entries(current)) {
        next[key] = ids.filter((id) => id !== dragStaffId);
      }
      next[dateKey] = [...new Set([...(next[dateKey] ?? []), dragStaffId])];
      nextAssignments = next;
      return next;
    });
    setDragStaffId(null);
    void runSupabaseAction(() => replaceMonthAssignments(supabase!, targetMonth, nextAssignments));
  }

  function updateStaff(staffId: string, patch: Partial<Staff>) {
    if (!canAdmin) {
      setErrorMessage("管理者のみスタッフ情報を編集できます。");
      return;
    }
    let nextStaff: Staff | null = null;
    setStaff((current) =>
      current.map((member) => {
        if (member.id !== staffId) return member;
        nextStaff = { ...member, ...patch };
        return nextStaff;
      }),
    );
    const staffToSave = nextStaff;
    if (staffToSave) {
      void runSupabaseAction(() => upsertStaff(supabase!, staffToSave));
    }
  }

  function addStaff() {
    if (!canAdmin) {
      setErrorMessage("管理者のみスタッフを追加できます。");
      return;
    }
    const id = crypto.randomUUID();
    const member = { id, authUserId: null, email: null, name: "新規スタッフ", note: "", workdays: [1, 2, 3, 4, 5] as Weekday[], weeklyDays: 3, monthlyMax: 14 };
    setStaff((current) => [...current, member]);
    setActiveStaffId(id);
    void runSupabaseAction(() => upsertStaff(supabase!, member));
  }

  function deleteStaff(staffId: string) {
    if (!canAdmin) {
      setErrorMessage("管理者のみスタッフを削除できます。");
      return;
    }
    setStaff((current) => current.filter((member) => member.id !== staffId));
    setRequests((current) => current.filter((request) => request.staffId !== staffId));
    setAssignments((current) =>
      Object.fromEntries(Object.entries(current).map(([date, ids]) => [date, ids.filter((id) => id !== staffId)])),
    );
    setActiveStaffId((current) => (current === staffId ? (staff.find((member) => member.id !== staffId)?.id ?? "") : current));
    void runSupabaseAction(() => deleteSupabaseStaff(supabase!, staffId));
  }

  function updateRequiredForDate(dateKey: string, count: number) {
    if (!canAdmin) {
      setErrorMessage("管理者のみ必要人数を編集できます。");
      return;
    }
    setRequired((current) => ({ ...current, [dateKey]: count }));
    void runSupabaseAction(() => upsertRequiredStaff(supabase!, { [dateKey]: count }));
  }

  async function inviteStaff(name: string, email: string, staffId?: string) {
    if (!supabase || !canAdmin) {
      setErrorMessage("管理者のみスタッフを招待できます。");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("ログイン情報がありません。");

      const response = await fetch("/api/staff/invite", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, name, staffId }),
      });
      const result = (await response.json()) as { staff?: Staff; error?: string };
      if (!response.ok || !result.staff) {
        throw new Error(result.error ?? "スタッフ招待に失敗しました。");
      }

      setStaff((current) => {
        const exists = current.some((member) => member.id === result.staff?.id);
        if (exists) {
          return current.map((member) => (member.id === result.staff?.id ? result.staff : member));
        }
        return [...current, result.staff!];
      });
      setActiveStaffId(result.staff.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "スタッフ招待に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  }

  async function login() {
    if (!supabase) return;
    setIsSaving(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    if (error) {
      setErrorMessage(error.message);
    }
    setIsSaving(false);
  }

  async function logout() {
    if (!supabase) return;
    setIsSaving(true);
    setErrorMessage("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
    }
    setIsSaving(false);
  }

  if (isSupabaseEnabled && !isAuthReady) {
    return <LoadingScreen message="ログイン状態を確認しています。" />;
  }

  if (isSupabaseEnabled && !authUser) {
    return (
      <LoginScreen
        email={loginEmail}
        errorMessage={errorMessage}
        isSaving={isSaving}
        onEmailChange={setLoginEmail}
        onLogin={login}
        onPasswordChange={setLoginPassword}
        password={loginPassword}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7f3] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-teal-700">Next.js + Supabase + Vercel MVP</p>
            <h1 className="text-2xl font-semibold">シフト管理</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSupabaseEnabled && authUser ? (
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {authRole === "admin" ? "管理者" : "スタッフ"}: {authUser.email}
              </span>
            ) : null}
            <input
              aria-label="対象月"
              className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
              type="month"
              value={targetMonth}
              onChange={(event) => setTargetMonth(event.target.value)}
            />
            <button
              className={classNames(
                "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium",
                mode === "staff" ? "bg-neutral-950 text-white" : "border border-neutral-300 bg-white",
              )}
              onClick={() => setMode("staff")}
            >
              <LogIn size={16} />
              スタッフ
            </button>
            {canAdmin ? (
              <button
                className={classNames(
                  "inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium",
                  mode === "admin" ? "bg-neutral-950 text-white" : "border border-neutral-300 bg-white",
                )}
                onClick={() => setMode("admin")}
              >
                <LayoutDashboard size={16} />
                管理者
              </button>
            ) : null}
            {isSupabaseEnabled ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium"
                onClick={logout}
              >
                <LogOut size={16} />
                ログアウト
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
        {!isSupabaseEnabled ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Supabase環境変数が未設定のため、サンプルデータで動作しています。
          </div>
        ) : null}
        {isLoading ? (
          <div className="mt-2 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            Supabaseからデータを読み込んでいます。
          </div>
        ) : null}
        {isSaving ? (
          <div className="mt-2 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
            Supabaseへ保存中です。
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {errorMessage}
          </div>
        ) : null}
      </div>

      {mode === "staff" ? (
        <StaffView
          activeStaff={activeStaff}
          assignments={assignments}
          canSwitchStaff={canAdmin}
          monthDates={monthDates}
          requests={requests}
          setActiveStaffId={setActiveStaffId}
          staff={staff}
          targetMonth={targetMonth}
          toggleRequest={toggleRequest}
          updateMemo={updateMemo}
        />
      ) : (
        <AdminView
          activeTab={adminTab}
          addStaff={addStaff}
          applyBulkRequired={applyBulkRequired}
          assignments={assignments}
          bulkValue={bulkValue}
          bulkWeekdays={bulkWeekdays}
          createShift={createShift}
          deleteStaff={deleteStaff}
          dragStaffId={dragStaffId}
          inviteStaff={inviteStaff}
          isLoading={isLoading}
          monthDates={monthDates}
          monthRequests={monthRequests}
          moveDraggedStaff={moveDraggedStaff}
          required={required}
          setActiveTab={setAdminTab}
          setBulkValue={setBulkValue}
          setBulkWeekdays={setBulkWeekdays}
          setDragStaffId={setDragStaffId}
          shiftIssues={shiftIssues}
          staff={staff}
          stats={stats}
          submittedStaffIds={submittedStaffIds}
          targetMonth={targetMonth}
          toggleAssignment={toggleAssignment}
          updateRequiredForDate={updateRequiredForDate}
          updateStaff={updateStaff}
        />
      )}
    </main>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f3] px-4 text-neutral-950">
      <div className="rounded-lg border border-neutral-200 bg-white px-6 py-5 text-sm text-neutral-700">{message}</div>
    </main>
  );
}

function LoginScreen({
  email,
  errorMessage,
  isSaving,
  onEmailChange,
  onLogin,
  onPasswordChange,
  password,
}: {
  email: string;
  errorMessage: string;
  isSaving: boolean;
  onEmailChange: (value: string) => void;
  onLogin: () => void;
  onPasswordChange: (value: string) => void;
  password: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f3] px-4 text-neutral-950">
      <form
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6"
        onSubmit={(event) => {
          event.preventDefault();
          onLogin();
        }}
      >
        <p className="text-sm font-medium text-teal-700">Supabase Auth</p>
        <h1 className="mt-1 text-2xl font-semibold">シフト管理ログイン</h1>
        <div className="mt-5 space-y-3">
          <label className="block text-sm font-medium">
            メールアドレス
            <input
              autoComplete="email"
              className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-3"
              onChange={(event) => onEmailChange(event.target.value)}
              type="email"
              value={email}
            />
          </label>
          <label className="block text-sm font-medium">
            パスワード
            <input
              autoComplete="current-password"
              className="mt-1 h-11 w-full rounded-md border border-neutral-300 px-3"
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              value={password}
            />
          </label>
        </div>
        {errorMessage ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {errorMessage}
          </div>
        ) : null}
        <button
          className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isSaving}
          type="submit"
        >
          <LogIn size={16} />
          {isSaving ? "ログイン中" : "ログイン"}
        </button>
      </form>
    </main>
  );
}

function StaffView({
  activeStaff,
  assignments,
  canSwitchStaff,
  monthDates,
  requests,
  setActiveStaffId,
  staff,
  targetMonth,
  toggleRequest,
  updateMemo,
}: {
  activeStaff?: Staff;
  assignments: ShiftAssignment;
  canSwitchStaff: boolean;
  monthDates: Date[];
  requests: TimeOffRequest[];
  setActiveStaffId: (id: string) => void;
  staff: Staff[];
  targetMonth: string;
  toggleRequest: (dateKey: string) => void;
  updateMemo: (dateKey: string, memo: string) => void;
}) {
  const ownRequests = requests.filter((request) => request.staffId === activeStaff?.id && request.date.startsWith(targetMonth));

  return (
    <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-lg border border-neutral-200 bg-white p-4">
        <label className="text-sm font-medium">スタッフログイン</label>
        <select
          className="mt-2 h-11 w-full rounded-md border border-neutral-300 bg-white px-3"
          disabled={!canSwitchStaff}
          value={activeStaff?.id}
          onChange={(event) => setActiveStaffId(event.target.value)}
        >
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <div className="mt-4 rounded-md bg-teal-50 p-3 text-sm text-teal-900">
          希望休は締切前ならタップで追加・解除できます。メモは選択後に入力できます。
        </div>
      </aside>

      <div className="space-y-4">
        <CalendarGrid
          assignments={assignments}
          monthDates={monthDates}
          requests={ownRequests}
          staff={staff}
          activeStaffId={activeStaff?.id}
          onDayClick={toggleRequest}
          onMemoChange={updateMemo}
        />
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-lg font-semibold">確定シフト</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {monthDates
              .filter((date) => assignments[toDateKey(date)]?.includes(activeStaff?.id ?? ""))
              .map((date) => (
                <div key={toDateKey(date)} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                  {format(date, "M/d")}（{weekdayLabels[date.getDay()]}）
                </div>
              ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function CalendarGrid({
  activeStaffId,
  assignments,
  monthDates,
  onDayClick,
  onMemoChange,
  requests,
}: {
  activeStaffId?: string;
  assignments: ShiftAssignment;
  monthDates: Date[];
  requests: TimeOffRequest[];
  staff: Staff[];
  onDayClick: (dateKey: string) => void;
  onMemoChange: (dateKey: string, memo: string) => void;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays size={20} />
        <h2 className="text-lg font-semibold">希望休カレンダー</h2>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-neutral-200 text-center text-xs font-medium text-neutral-600">
        {weekdayLabels.map((label) => (
          <div key={label} className="border-b border-r border-neutral-200 py-2">
            {label}
          </div>
        ))}
        {Array.from({ length: monthDates[0]?.getDay() ?? 0 }).map((_, index) => (
          <div key={`blank-${index}`} className="min-h-28 border-b border-r border-neutral-200 bg-neutral-50" />
        ))}
        {monthDates.map((date) => {
          const key = toDateKey(date);
          const request = requests.find((item) => item.date === key);
          const closed = isClosedDay(date);
          const working = assignments[key]?.includes(activeStaffId ?? "");
          return (
            <button
              key={key}
              className={classNames(
                "min-h-28 border-b border-r border-neutral-200 p-2 text-left align-top transition",
                closed && "bg-neutral-100 text-neutral-400",
                request && "bg-rose-50 ring-2 ring-inset ring-rose-300",
                working && "bg-emerald-50",
                !closed && "hover:bg-teal-50",
              )}
              onClick={() => !closed && onDayClick(key)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{date.getDate()}</span>
                {request ? <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[11px] text-white">休</span> : null}
              </div>
              {getJapaneseHolidayName(date) ? <p className="mt-1 text-[11px]">{getJapaneseHolidayName(date)}</p> : null}
              {working ? <p className="mt-2 text-xs font-medium text-emerald-700">出勤</p> : null}
              {request ? (
                <input
                  className="mt-2 h-8 w-full rounded border border-rose-200 bg-white px-2 text-xs text-neutral-900"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onMemoChange(key, event.target.value)}
                  placeholder="メモ"
                  value={request.memo}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AdminView(props: {
  activeTab: AdminTab;
  addStaff: () => void;
  applyBulkRequired: () => void;
  assignments: ShiftAssignment;
  bulkValue: number;
  bulkWeekdays: Weekday[];
  createShift: () => void;
  deleteStaff: (staffId: string) => void;
  dragStaffId: string | null;
  inviteStaff: (name: string, email: string, staffId?: string) => void;
  isLoading: boolean;
  monthDates: Date[];
  monthRequests: TimeOffRequest[];
  moveDraggedStaff: (dateKey: string) => void;
  required: RequiredStaff;
  setActiveTab: (tab: AdminTab) => void;
  setBulkValue: (value: number) => void;
  setBulkWeekdays: (weekdays: Weekday[]) => void;
  setDragStaffId: (id: string | null) => void;
  shiftIssues: Array<{ date: string; required: number; assigned: number }>;
  staff: Staff[];
  stats: Array<{ staffId: string; name: string; count: number }>;
  submittedStaffIds: Set<string>;
  targetMonth: string;
  toggleAssignment: (dateKey: string, staffId: string) => void;
  updateRequiredForDate: (dateKey: string, count: number) => void;
  updateStaff: (staffId: string, patch: Partial<Staff>) => void;
}) {
  const tabLabels: Record<AdminTab, string> = {
    dashboard: "ダッシュボード",
    staff: "スタッフ",
    required: "必要人数",
    requests: "希望休",
    shift: "シフト",
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={classNames(
              "h-10 shrink-0 rounded-md px-3 text-sm font-medium",
              props.activeTab === tab ? "bg-neutral-950 text-white" : "border border-neutral-300 bg-white",
            )}
            onClick={() => props.setActiveTab(tab)}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      {props.activeTab === "dashboard" ? <Dashboard {...props} /> : null}
      {props.activeTab === "staff" ? <StaffManager {...props} /> : null}
      {props.activeTab === "required" ? <RequiredManager {...props} /> : null}
      {props.activeTab === "requests" ? <RequestManager {...props} /> : null}
      {props.activeTab === "shift" ? <ShiftEditor {...props} /> : null}
    </section>
  );
}

function Dashboard({
  createShift,
  shiftIssues,
  staff,
  submittedStaffIds,
  targetMonth,
}: Parameters<typeof AdminView>[0]) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="スタッフ人数" value={`${staff.length}人`} />
        <Metric label="希望休提出" value={`${submittedStaffIds.size}/${staff.length}`} />
        <Metric label="対象月" value={targetMonth} />
        <Metric label="不足日" value={`${shiftIssues.length}日`} tone={shiftIssues.length ? "warn" : "ok"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white" onClick={createShift}>
          <Sparkles size={17} />
          自動作成
        </button>
      </div>
      <IssueList issues={shiftIssues} />
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold">月別シフト状況</h2>
        <p className="mt-2 text-sm text-neutral-600">自動作成後、不足日とスタッフ別勤務日数がここで確認できます。</p>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-sm text-neutral-600">{label}</p>
      <p className={classNames("mt-2 text-2xl font-semibold", tone === "warn" && "text-amber-700", tone === "ok" && "text-teal-700")}>{value}</p>
    </div>
  );
}

function StaffManager({ addStaff, deleteStaff, inviteStaff, staff, updateStaff }: Parameters<typeof AdminView>[0]) {
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">スタッフ管理</h2>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white" onClick={addStaff}>
          <Users size={16} />
          追加
        </button>
      </div>
      <div className="mb-4 grid gap-3 rounded-lg border border-teal-100 bg-teal-50 p-3 lg:grid-cols-[1fr_1fr_auto]">
        <input
          className="h-10 rounded-md border border-teal-200 bg-white px-3"
          onChange={(event) => setInviteName(event.target.value)}
          placeholder="スタッフ名"
          value={inviteName}
        />
        <input
          className="h-10 rounded-md border border-teal-200 bg-white px-3"
          onChange={(event) => setInviteEmail(event.target.value)}
          placeholder="メールアドレス"
          type="email"
          value={inviteEmail}
        />
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-medium text-white"
          onClick={() => inviteStaff(inviteName, inviteEmail)}
          type="button"
        >
          <LogIn size={16} />
          招待
        </button>
      </div>
      <div className="grid gap-3">
        {staff.map((member) => (
          <div key={member.id} className="grid gap-3 rounded-lg border border-neutral-200 p-3 lg:grid-cols-[1fr_1fr_150px_150px_44px]">
            <input className="h-10 rounded-md border border-neutral-300 px-3" value={member.name} onChange={(event) => updateStaff(member.id, { name: event.target.value })} />
            <input className="h-10 rounded-md border border-neutral-300 px-3" placeholder="備考" value={member.note} onChange={(event) => updateStaff(member.id, { note: event.target.value })} />
            <input className="h-10 rounded-md border border-neutral-300 px-3" min={1} max={5} type="number" value={member.weeklyDays} onChange={(event) => updateStaff(member.id, { weeklyDays: Number(event.target.value) })} />
            <input className="h-10 rounded-md border border-neutral-300 px-3" min={1} max={31} type="number" value={member.monthlyMax} onChange={(event) => updateStaff(member.id, { monthlyMax: Number(event.target.value) })} />
            <button
              aria-label={`${member.name}を削除`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700"
              onClick={() => deleteStaff(member.id)}
              type="button"
            >
              <Trash2 size={16} />
            </button>
            <input
              className="h-10 rounded-md border border-neutral-300 px-3 text-sm lg:col-span-2"
              onChange={(event) => updateStaff(member.id, { email: event.target.value || null })}
              placeholder="メールアドレス"
              type="email"
              value={member.email ?? ""}
            />
            <input
              className="h-10 rounded-md border border-neutral-300 px-3 text-sm lg:col-span-2"
              onChange={(event) => updateStaff(member.id, { authUserId: event.target.value || null })}
              placeholder="Supabase Auth User ID"
              value={member.authUserId ?? ""}
            />
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 text-sm font-medium text-teal-800"
              onClick={() => inviteStaff(member.name, member.email ?? "", member.id)}
              type="button"
            >
              <LogIn size={15} />
              招待
            </button>
            <div className="flex flex-wrap gap-2 lg:col-span-5">
              {weekdays.map((weekday) => (
                <label key={weekday} className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm">
                  <input
                    checked={member.workdays.includes(weekday)}
                    onChange={() => {
                      const next = member.workdays.includes(weekday)
                        ? member.workdays.filter((day) => day !== weekday)
                        : [...member.workdays, weekday].sort();
                      updateStaff(member.id, { workdays: next as Weekday[] });
                    }}
                    type="checkbox"
                  />
                  {weekdayLabels[weekday]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RequiredManager({
  applyBulkRequired,
  bulkValue,
  bulkWeekdays,
  monthDates,
  required,
  setBulkValue,
  setBulkWeekdays,
  updateRequiredForDate,
}: Parameters<typeof AdminView>[0]) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-semibold">一括入力</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {weekdays.map((weekday) => (
            <label key={weekday} className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm">
              <input
                checked={bulkWeekdays.includes(weekday)}
                onChange={() => setBulkWeekdays(bulkWeekdays.includes(weekday) ? bulkWeekdays.filter((day) => day !== weekday) : [...bulkWeekdays, weekday])}
                type="checkbox"
              />
              {weekdayLabels[weekday]}
            </label>
          ))}
          <input className="h-10 w-24 rounded-md border border-neutral-300 px-3" min={0} type="number" value={bulkValue} onChange={(event) => setBulkValue(Number(event.target.value))} />
          <button className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white" onClick={applyBulkRequired}>
            <Save size={16} />
            適用
          </button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {monthDates.map((date) => {
          const key = toDateKey(date);
          const closed = isClosedDay(date);
          return (
            <label key={key} className={classNames("rounded-lg border border-neutral-200 bg-white p-3", closed && "bg-neutral-100 text-neutral-400")}>
              <span className="text-sm font-medium">
                {format(date, "M/d")}（{weekdayLabels[date.getDay()]}）
              </span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-neutral-300 px-3"
                disabled={closed}
                min={0}
                type="number"
                value={required[key] ?? getDefaultRequired(date)}
                onChange={(event) => updateRequiredForDate(key, Number(event.target.value))}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}

function RequestManager({ monthRequests, staff }: Parameters<typeof AdminView>[0]) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold">希望休一覧</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left">
              <th className="py-2">日付</th>
              <th>スタッフ</th>
              <th>メモ</th>
              <th>提出</th>
            </tr>
          </thead>
          <tbody>
            {monthRequests.map((request) => (
              <tr key={`${request.staffId}-${request.date}`} className="border-b border-neutral-100">
                <td className="py-2">{request.date}</td>
                <td>{staff.find((member) => member.id === request.staffId)?.name}</td>
                <td>{request.memo || "-"}</td>
                <td>{request.submittedAt ? "済" : "未"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ShiftEditor({
  assignments,
  createShift,
  dragStaffId,
  monthDates,
  moveDraggedStaff,
  required,
  setDragStaffId,
  shiftIssues,
  staff,
  stats,
  targetMonth,
  toggleAssignment,
}: Parameters<typeof AdminView>[0]) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white" onClick={createShift}>
          <Sparkles size={16} />
          自動作成
        </button>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white" onClick={() => downloadShiftWorkbook(targetMonth, staff, assignments)}>
          <Download size={16} />
          Excel出力
        </button>
      </div>
      <IssueList issues={shiftIssues} />
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-semibold">スタッフ別勤務日数</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {stats.map((item) => (
            <span key={item.staffId} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
              {item.name}: {item.count}日
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left">日付</th>
              <th className="px-3 py-2 text-left">必要</th>
              <th className="px-3 py-2 text-left">勤務スタッフ</th>
              <th className="px-3 py-2 text-left">クリックで編集</th>
            </tr>
          </thead>
          <tbody>
            {monthDates.map((date) => {
              const key = toDateKey(date);
              const closed = isClosedDay(date);
              return (
                <tr key={key} className={classNames("border-b border-neutral-100", closed && "bg-neutral-100 text-neutral-400")}>
                  <td className="sticky left-0 bg-inherit px-3 py-3 font-medium">
                    {format(date, "M/d")}（{weekdayLabels[date.getDay()]}）
                  </td>
                  <td className="px-3 py-3">{closed ? "-" : required[key] ?? getDefaultRequired(date)}</td>
                  <td
                    className="min-h-14 px-3 py-3"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveDraggedStaff(key)}
                  >
                    <div className="flex min-h-9 flex-wrap gap-2">
                      {(assignments[key] ?? []).map((staffId) => (
                        <span
                          key={staffId}
                          className={classNames("cursor-grab rounded-md bg-emerald-100 px-2 py-1 text-emerald-900", dragStaffId === staffId && "opacity-50")}
                          draggable
                          onDragStart={() => setDragStaffId(staffId)}
                          onDragEnd={() => setDragStaffId(null)}
                        >
                          {staff.find((member) => member.id === staffId)?.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {staff.map((member) => (
                        <button
                          key={member.id}
                          className={classNames(
                            "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs",
                            assignments[key]?.includes(member.id)
                              ? "border-teal-700 bg-teal-700 text-white"
                              : "border-neutral-300 bg-white text-neutral-800",
                          )}
                          disabled={closed}
                          onClick={() => toggleAssignment(key, member.id)}
                          type="button"
                        >
                          {assignments[key]?.includes(member.id) ? <Check size={13} /> : null}
                          {member.name}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IssueList({ issues }: { issues: Array<{ date: string; required: number; assigned: number }> }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="font-semibold">必要人数不足日一覧</h2>
      {issues.length === 0 ? (
        <p className="mt-2 text-sm text-teal-700">不足日はありません。</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {issues.map((issue) => (
            <div key={issue.date} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {issue.date}: {issue.assigned}/{issue.required}人
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
