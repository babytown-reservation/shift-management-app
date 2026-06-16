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
import {
  getMonthDates,
  getMonthDegreeLabel,
  getShiftPeriodLabel,
  getWeekday,
  isDateInShiftPeriod,
  monthKey,
  toDateKey,
  weekdayLabels,
} from "@/lib/date-utils";
import { downloadShiftWorkbook } from "@/lib/excel";
import { getJapaneseHolidayName, isClosedDay } from "@/lib/holidays";
import { defaultRequiredByWeekday, initialRequests, initialRequiredStaff, initialStaff } from "@/lib/sample-data";
import { generateShift, getShiftStats } from "@/lib/schedule";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  deleteStaff as deleteSupabaseStaff,
  deleteTimeOffRequest,
  loadSupabaseStore,
  upsertRequiredStaff,
  upsertStaff,
  upsertTimeOffRequest,
} from "@/lib/supabase-store";
import type { RequiredStaff, ShiftAssignment, Staff, TimeOffRequest, Weekday } from "@/lib/types";

const weekdays: Weekday[] = [1, 2, 3, 4, 5];
const tabs = ["dashboard", "staff", "required", "requests", "shift"] as const;
type AdminTab = (typeof tabs)[number];
type UserRole = "admin" | "staff";
type RequestSaveStatus = "idle" | "saving" | "saved" | "error";

function getDefaultRequired(date: Date) {
  return isClosedDay(date) ? 0 : defaultRequiredByWeekday[getWeekday(date)] ?? 0;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function uniqueAssignments(assignments: ShiftAssignment): ShiftAssignment {
  return Object.fromEntries(
    Object.entries(assignments).map(([date, staffIds]) => [date, [...new Set(staffIds)]]),
  );
}

function countAssignmentRows(assignments: ShiftAssignment) {
  return Object.values(assignments).reduce((sum, staffIds) => sum + staffIds.length, 0);
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
  const [loginMode, setLoginMode] = useState<UserRole>("staff");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
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
  const [isGeneratingShift, setIsGeneratingShift] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [requestSaveStatus, setRequestSaveStatus] = useState<RequestSaveStatus>("idle");
  const [requestSaveMessage, setRequestSaveMessage] = useState("日付とメモは自動保存されます。");
  const [staffSaveStatus, setStaffSaveStatus] = useState<RequestSaveStatus>("idle");
  const [staffSaveMessage, setStaffSaveMessage] = useState("スタッフ編集は自動保存されます。");
  const [staffFetchCount, setStaffFetchCount] = useState(initialStaff.length);
  const [shiftSaveStatus, setShiftSaveStatus] = useState<RequestSaveStatus>("idle");
  const [shiftSaveMessage, setShiftSaveMessage] = useState("シフト編集は自動保存されます。");
  const [shiftFetchStatus, setShiftFetchStatus] = useState<{
    rowsCount: number | null;
    source: string;
    targetMonth: string;
  }>({ rowsCount: null, source: "未取得", targetMonth });
  const canAdmin = !isSupabaseEnabled || authRole === "admin";

  const monthDates = useMemo(() => getMonthDates(targetMonth), [targetMonth]);
  const targetPeriodLabel = useMemo(() => getShiftPeriodLabel(targetMonth), [targetMonth]);
  const renderedDateRangeLabel = useMemo(() => {
    if (!monthDates.length) return targetPeriodLabel;
    return `${format(monthDates[0], "yyyy/M/d")}〜${format(monthDates[monthDates.length - 1], "yyyy/M/d")}`;
  }, [monthDates, targetPeriodLabel]);
  const monthDegreeLabel = useMemo(() => getMonthDegreeLabel(targetMonth), [targetMonth]);
  const activeStaff = staff.find((member) => member.id === activeStaffId) ?? staff[0];
  const monthRequests = requests.filter((request) => isDateInShiftPeriod(request.date, targetMonth));
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
  const displayedAssignmentRowsCount = countAssignmentRows(assignments);

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

  const runRequestSaveAction = useCallback(
    async (action: () => Promise<void>) => {
      setRequestSaveStatus("saving");
      setRequestSaveMessage("保存中...");
      if (!supabase) {
        setRequestSaveStatus("saved");
        setRequestSaveMessage("保存しました");
        return;
      }

      try {
        await action();
        setRequestSaveStatus("saved");
        setRequestSaveMessage("保存しました");
      } catch (error) {
        const message = error instanceof Error ? error.message : "希望休の保存に失敗しました。";
        setRequestSaveStatus("error");
        setRequestSaveMessage(message);
        setErrorMessage(message);
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

    const scope = authRole === "admin" ? { role: "admin" as const } : { role: "staff" as const, userId: authUser.id, email: authUser.email };
    if (authRole === "staff") {
      queueMicrotask(() => setMode("staff"));
    }

    loadSupabaseStore(supabase, targetMonth, scope)
      .then(async (store) => {
        if (cancelled) return;
        let loadedAssignments = store.assignments;
        if (authRole === "admin") {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw new Error(`ログイン情報を確認できません: ${error.message}`);
          let token = data.session?.access_token;
          if (!token) {
            const refreshed = await supabase.auth.refreshSession();
            if (refreshed.error) throw new Error(`ログイン情報を確認できません: ${refreshed.error.message}`);
            token = refreshed.data.session?.access_token;
          }
          if (!token) throw new Error("ログイン情報を確認できません。再ログインしてください。");

          console.log("[shift_assignments] GET /api/shifts/save request", {
            source: "initial-load",
            targetMonth,
          });
          const response = await fetch(`/api/shifts/save?targetMonth=${encodeURIComponent(targetMonth)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const result = (await response.json()) as { assignments?: ShiftAssignment; error?: string; rowsCount?: number };
          console.log("[shift_assignments] GET /api/shifts/save response JSON", {
            ok: response.ok,
            result,
            source: "initial-load",
            status: response.status,
            targetMonth,
          });
          if (!response.ok) throw new Error(result.error ?? "シフト取得に失敗しました。");
          loadedAssignments = uniqueAssignments(result.assignments ?? {});
          const fetchedRowsCount = result.rowsCount ?? countAssignmentRows(loadedAssignments);
          console.log("[shift_assignments] initial fetch", {
            assignmentsCount: countAssignmentRows(loadedAssignments),
            rowsCount: fetchedRowsCount,
            targetMonth,
          });
          setShiftFetchStatus({ rowsCount: fetchedRowsCount, source: "初期読み込み", targetMonth });
        }
        if (cancelled) return;
        console.log("[staff] initial fetch", {
          rowsCount: store.staff.length,
          source: "initial-load",
        });
        setStaffFetchCount(store.staff.length);
        setStaff(store.staff);
        setRequests(store.requests);
        setRequired(store.required);
        console.log("[shift_assignments] setAssignments", {
          displayedCount: countAssignmentRows(loadedAssignments),
          source: "initial-load",
          targetMonth,
        });
        setAssignments(loadedAssignments);
        setActiveStaffId((current) => (store.staff.some((member) => member.id === current) ? current : (store.staff[0]?.id ?? "")));
        if (authRole === "staff" && store.staff.length === 0) {
          setErrorMessage("ログイン中のメールアドレスに紐づくスタッフ情報がありません。管理者にスタッフ招待またはメール登録を依頼してください。");
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
      void runRequestSaveAction(() => deleteTimeOffRequest(supabase!, activeStaff.id, dateKey));
      return;
    }
    const request = { staffId: activeStaff.id, date: dateKey, memo: "", submittedAt: new Date().toISOString() };
    setRequests((current) => [
      ...current,
      request,
    ]);
    void runRequestSaveAction(() => upsertTimeOffRequest(supabase!, request));
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
      void runRequestSaveAction(() => upsertTimeOffRequest(supabase!, { ...nextRequest, memo }));
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

  async function createShift() {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを自動作成できます。");
      return;
    }
    if (isGeneratingShift) return;

    setIsGeneratingShift(true);
    setIsSaving(true);
    setErrorMessage("");

    const filledRequired = monthDates.reduce<RequiredStaff>((acc, date) => {
      acc[toDateKey(date)] = required[toDateKey(date)] ?? getDefaultRequired(date);
      return acc;
    }, {});

    try {
      const result = generateShift(targetMonth, staff, monthRequests, filledRequired);
      const nextAssignments = uniqueAssignments(result.assignments);
      if (supabase) {
        await upsertRequiredStaff(supabase, filledRequired);
        await saveAndReloadShiftAssignments(nextAssignments, "auto-generate");
      } else {
        setAssignments(nextAssignments);
      }
      setAdminTab("shift");
    } catch (error) {
      setErrorMessage(`シフト保存に失敗しました: ${error instanceof Error ? error.message : "不明なエラー"}`);
    } finally {
      setIsSaving(false);
      setIsGeneratingShift(false);
    }
  }

  function toggleAssignment(dateKey: string, staffId: string) {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを編集できます。");
      return;
    }
    const selected = new Set(assignments[dateKey] ?? []);
    if (selected.has(staffId)) selected.delete(staffId);
    else selected.add(staffId);
    const nextAssignments = uniqueAssignments({ ...assignments, [dateKey]: [...selected] });
    console.log("[shift_assignments] manual edit nextAssignments", {
      dateKey,
      rowsCount: countAssignmentRows(nextAssignments),
      staffIds: nextAssignments[dateKey] ?? [],
      targetMonth,
    });
    setAssignments(nextAssignments);
    void saveAndReloadShiftAssignments(nextAssignments, "manual-toggle").catch(() => undefined);
  }

  function moveDraggedStaff(dateKey: string) {
    if (!canAdmin) {
      setErrorMessage("管理者のみシフトを編集できます。");
      return;
    }
    if (!dragStaffId || isClosedDay(new Date(dateKey))) return;
    const next: ShiftAssignment = {};
    for (const [key, ids] of Object.entries(assignments)) {
      next[key] = ids.filter((id) => id !== dragStaffId);
    }
    next[dateKey] = [...(next[dateKey] ?? []), dragStaffId];
    const nextAssignments = uniqueAssignments(next);
    console.log("[shift_assignments] drag edit nextAssignments", {
      dateKey,
      rowsCount: countAssignmentRows(nextAssignments),
      staffIds: nextAssignments[dateKey] ?? [],
      targetMonth,
    });
    setAssignments(nextAssignments);
    setDragStaffId(null);
    void saveAndReloadShiftAssignments(nextAssignments, "drag").catch(() => undefined);
  }

  function updateStaff(staffId: string, patch: Partial<Staff>) {
    if (!canAdmin) {
      setErrorMessage("管理者のみスタッフ情報を編集できます。");
      return;
    }
    const currentStaff = staff.find((member) => member.id === staffId);
    if (!currentStaff) return;

    const staffToSave = { ...currentStaff, ...patch };
    console.log("[staff] edit nextStaff", {
      id: staffToSave.id,
      monthlyMax: staffToSave.monthlyMax,
      name: staffToSave.name,
      weeklyDays: staffToSave.weeklyDays,
      workdays: staffToSave.workdays,
    });
    setStaff((current) => current.map((member) => (member.id === staffId ? staffToSave : member)));
    void saveStaff(staffToSave);
  }

  async function saveStaff(staffToSave: Staff) {
    if (!supabase) {
      setStaffSaveStatus("saved");
      setStaffSaveMessage("スタッフ保存済み");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setStaffSaveStatus("saving");
    setStaffSaveMessage("スタッフ保存中...");

    try {
      await upsertStaff(supabase, staffToSave);
      console.log("[staff] saved", {
        id: staffToSave.id,
        monthlyMax: staffToSave.monthlyMax,
        weeklyDays: staffToSave.weeklyDays,
        workdays: staffToSave.workdays,
      });
      setStaffSaveStatus("saved");
      setStaffSaveMessage("スタッフ保存済み");
    } catch (error) {
      const message = error instanceof Error ? error.message : "スタッフ保存に失敗しました。";
      setStaffSaveStatus("error");
      setStaffSaveMessage(`スタッフ保存失敗: ${message}`);
      setErrorMessage(`スタッフ保存に失敗しました: ${message}`);
    } finally {
      setIsSaving(false);
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
    void saveStaff(member);
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
      const token = await getCurrentAccessToken();

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

  async function getCurrentAccessToken() {
    if (!supabase) throw new Error("Supabaseが未設定です。");

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(`ログイン情報を確認できません: ${error.message}`);
    }

    let token = data.session?.access_token;
    if (!token) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) {
        throw new Error(`ログイン情報を確認できません: ${refreshed.error.message}`);
      }
      token = refreshed.data.session?.access_token;
    }

    if (!token) {
      throw new Error("ログイン情報を確認できません。再ログインしてください。");
    }

    return token;
  }

  async function fetchSavedShiftAssignments() {
    if (!supabase || !canAdmin) {
      throw new Error("管理者のみシフトを取得できます。");
    }

    const token = await getCurrentAccessToken();
    console.log("[shift_assignments] GET /api/shifts/save request", {
      source: "after-save",
      targetMonth,
    });
    const response = await fetch(`/api/shifts/save?targetMonth=${encodeURIComponent(targetMonth)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = (await response.json()) as { assignments?: ShiftAssignment; error?: string; rowsCount?: number };
    console.log("[shift_assignments] GET /api/shifts/save response JSON", {
      ok: response.ok,
      result,
      source: "after-save",
      status: response.status,
      targetMonth,
    });
    if (!response.ok) {
      throw new Error(result.error ?? "シフト取得に失敗しました。");
    }

    const fetchedAssignments = uniqueAssignments(result.assignments ?? {});
    const fetchedRowsCount = result.rowsCount ?? countAssignmentRows(fetchedAssignments);
    console.log("[shift_assignments] refetch after save", {
      assignmentsCount: countAssignmentRows(fetchedAssignments),
      rowsCount: fetchedRowsCount,
      targetMonth,
    });
    setShiftFetchStatus({ rowsCount: fetchedRowsCount, source: "保存後再取得", targetMonth });
    return fetchedAssignments;
  }

  async function saveAndReloadShiftAssignments(nextAssignments: ShiftAssignment, source: string) {
    if (!supabase) {
      setAssignments(nextAssignments);
      setShiftSaveStatus("saved");
      setShiftSaveMessage("保存しました");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setShiftSaveStatus("saving");
    setShiftSaveMessage("保存中...");

    try {
      const saveResult = await saveShiftAssignments(nextAssignments);
      console.log("[shift_assignments] save completed", {
        rowsCount: saveResult.rowsCount,
        savedCount: saveResult.savedCount,
        source,
        targetMonth,
      });
      const reloadedAssignments = await fetchSavedShiftAssignments();
      console.log("[shift_assignments] setAssignments", {
        displayedCount: countAssignmentRows(reloadedAssignments),
        source: `${source}-refetch`,
        targetMonth,
      });
      setAssignments(reloadedAssignments);
      setShiftSaveStatus("saved");
      setShiftSaveMessage("保存しました");
    } catch (error) {
      const message = error instanceof Error ? error.message : "シフト保存に失敗しました。";
      setErrorMessage(`シフト保存に失敗しました: ${message}`);
      setShiftSaveStatus("error");
      setShiftSaveMessage(`保存に失敗しました: ${message}`);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  async function saveShiftAssignments(nextAssignments: ShiftAssignment) {
    if (!supabase) {
      return { rowsCount: 0, savedCount: 0 };
    }
    if (!canAdmin) {
      throw new Error("管理者のみシフトを保存できます。");
    }

    const token = await getCurrentAccessToken();
    const inputCount = countAssignmentRows(nextAssignments);

    const response = await fetch("/api/shifts/save", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignments: nextAssignments,
        targetMonth,
      }),
    });
    const result = (await response.json()) as { error?: string; rowsCount?: number; savedCount?: number };
    if (!response.ok) {
      throw new Error(result.error ?? "シフト保存に失敗しました。");
    }
    console.log("[shift_assignments] save response", {
      inputCount,
      rowsCount: result.rowsCount ?? 0,
      savedCount: result.savedCount ?? 0,
      targetMonth,
    });
    return { rowsCount: result.rowsCount ?? 0, savedCount: result.savedCount ?? 0 };
  }

  async function adminLogin() {
    if (!supabase) return;
    setIsSaving(true);
    setErrorMessage("");
    setLoginNotice("");
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    if (error) {
      setErrorMessage(error.message);
    }
    setIsSaving(false);
  }

  async function sendStaffMagicLink() {
    setIsSaving(true);
    setErrorMessage("");
    setLoginNotice("");
    try {
      const response = await fetch("/api/auth/staff-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "ログインリンクを送信できませんでした。");
      }
      setLoginNotice("ログインリンクを送信しました。メール内のリンクを開くとログインできます。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "ログインリンクを送信できませんでした。");
    } finally {
      setIsSaving(false);
    }
  }

  async function resetAdminPassword() {
    if (!supabase) return;
    setIsSaving(true);
    setErrorMessage("");
    setLoginNotice("");
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
      redirectTo: window.location.origin,
    });
    if (error) {
      setErrorMessage(error.message);
    } else {
      setLoginNotice("管理者用のパスワード再設定メールを送信しました。");
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
        loginMode={loginMode}
        notice={loginNotice}
        onEmailChange={setLoginEmail}
        onAdminLogin={adminLogin}
        onPasswordChange={setLoginPassword}
        onResetAdminPassword={resetAdminPassword}
        onSendStaffMagicLink={sendStaffMagicLink}
        onModeChange={setLoginMode}
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
            <p className="mt-1 text-sm text-neutral-600">
              {monthDegreeLabel} / 対象期間：{targetPeriodLabel}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSupabaseEnabled && authUser ? (
              <span className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {authRole === "admin" ? "管理者" : "スタッフ"}: {authUser.email}
              </span>
            ) : null}
            <span className="text-sm font-medium text-neutral-700">月度</span>
            <input
              aria-label="対象月度"
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
        {canAdmin ? (
          <div className="space-y-2">
            <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-950">
              取得件数: {shiftFetchStatus.rowsCount ?? "-"}件 / 表示件数: {displayedAssignmentRowsCount}件 / 対象月度:{" "}
              {shiftFetchStatus.targetMonth} / 取得元: {shiftFetchStatus.source}
            </div>
            <div
              className={classNames(
                "rounded-md border px-4 py-3 text-sm font-medium",
                staffSaveStatus === "saving" && "border-neutral-200 bg-white text-neutral-700",
                staffSaveStatus === "saved" && "border-teal-200 bg-teal-50 text-teal-800",
                staffSaveStatus === "error" && "border-rose-200 bg-rose-50 text-rose-900",
                staffSaveStatus === "idle" && "border-neutral-200 bg-neutral-50 text-neutral-600",
              )}
            >
              {staffSaveMessage} / スタッフ取得件数: {staffFetchCount}件
            </div>
          </div>
        ) : null}
        {!isSupabaseEnabled ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
          renderedDateRangeLabel={renderedDateRangeLabel}
          targetPeriodLabel={targetPeriodLabel}
          requestSaveMessage={requestSaveMessage}
          requestSaveStatus={requestSaveStatus}
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
          isGeneratingShift={isGeneratingShift}
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
          shiftSaveMessage={shiftSaveMessage}
          shiftSaveStatus={shiftSaveStatus}
          staff={staff}
          stats={stats}
          submittedStaffIds={submittedStaffIds}
          targetMonth={targetMonth}
          targetPeriodLabel={targetPeriodLabel}
          renderedDateRangeLabel={renderedDateRangeLabel}
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
  loginMode,
  notice,
  onAdminLogin,
  onEmailChange,
  onModeChange,
  onPasswordChange,
  onResetAdminPassword,
  onSendStaffMagicLink,
  password,
}: {
  email: string;
  errorMessage: string;
  isSaving: boolean;
  loginMode: UserRole;
  notice: string;
  onAdminLogin: () => void;
  onEmailChange: (value: string) => void;
  onModeChange: (value: UserRole) => void;
  onPasswordChange: (value: string) => void;
  onResetAdminPassword: () => void;
  onSendStaffMagicLink: () => void;
  password: string;
}) {
  const isStaffLogin = loginMode === "staff";

  return (
    <main className="flex min-h-screen flex-col bg-[#f7f7f3] text-neutral-950">
      <form
        className="mx-auto my-auto w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (isStaffLogin) onSendStaffMagicLink();
          else onAdminLogin();
        }}
      >
        <p className="text-sm font-medium text-teal-700">Supabase Auth</p>
        <h1 className="mt-1 text-2xl font-semibold">シフト管理ログイン</h1>
        <div className="mt-5 grid grid-cols-2 gap-2 rounded-md bg-neutral-100 p-1">
          <button
            className={classNames(
              "h-10 rounded px-3 text-sm font-medium",
              isStaffLogin ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600",
            )}
            onClick={() => onModeChange("staff")}
            type="button"
          >
            スタッフ
          </button>
          <button
            className={classNames(
              "h-10 rounded px-3 text-sm font-medium",
              !isStaffLogin ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600",
            )}
            onClick={() => onModeChange("admin")}
            type="button"
          >
            管理者
          </button>
        </div>
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
          {isStaffLogin ? (
            <div className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
              スタッフはメールアドレスだけでログインできます。届いたメール内のリンクを開いてください。
            </div>
          ) : (
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
          )}
        </div>
        {notice ? (
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {notice}
          </div>
        ) : null}
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
          {isSaving ? "送信中" : isStaffLogin ? "ログインリンクを送信" : "管理者ログイン"}
        </button>
        {!isStaffLogin ? (
          <button
            className="mt-3 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 disabled:opacity-60"
            disabled={isSaving || !email}
            onClick={onResetAdminPassword}
            type="button"
          >
            管理者パスワード再設定メールを送信
          </button>
        ) : null}
      </form>
    </main>
  );
}

function StaffView({
  activeStaff,
  assignments,
  canSwitchStaff,
  monthDates,
  renderedDateRangeLabel,
  targetPeriodLabel,
  requestSaveMessage,
  requestSaveStatus,
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
  renderedDateRangeLabel: string;
  targetPeriodLabel: string;
  requestSaveMessage: string;
  requestSaveStatus: RequestSaveStatus;
  requests: TimeOffRequest[];
  setActiveStaffId: (id: string) => void;
  staff: Staff[];
  targetMonth: string;
  toggleRequest: (dateKey: string) => void;
  updateMemo: (dateKey: string, memo: string) => void;
}) {
  const ownRequests = requests.filter(
    (request) => request.staffId === activeStaff?.id && isDateInShiftPeriod(request.date, targetMonth),
  );

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
          日付をタップすると自動保存されます。もう一度タップすると解除されます。
          <br />
          メモも入力すると自動保存されます。
        </div>
        <div
          className={classNames(
            "mt-3 rounded-md border px-3 py-2 text-sm",
            requestSaveStatus === "saving" && "border-neutral-200 bg-white text-neutral-700",
            requestSaveStatus === "saved" && "border-teal-200 bg-teal-50 text-teal-800",
            requestSaveStatus === "error" && "border-rose-200 bg-rose-50 text-rose-900",
            requestSaveStatus === "idle" && "border-neutral-200 bg-neutral-50 text-neutral-600",
          )}
        >
          {requestSaveMessage}
        </div>
      </aside>

      <div className="space-y-4">
        <CalendarGrid
          assignments={assignments}
          monthDates={monthDates}
          renderedDateRangeLabel={renderedDateRangeLabel}
          targetPeriodLabel={targetPeriodLabel}
          requests={ownRequests}
          staff={staff}
          activeStaffId={activeStaff?.id}
          onDayClick={toggleRequest}
          onMemoChange={updateMemo}
          requestSaveMessage={requestSaveMessage}
          requestSaveStatus={requestSaveStatus}
        />
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-lg font-semibold">確定シフト</h2>
          <p className="mt-1 text-sm font-medium text-neutral-700">表示日付：{renderedDateRangeLabel}</p>
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
  renderedDateRangeLabel,
  targetPeriodLabel,
  onDayClick,
  onMemoChange,
  requestSaveMessage,
  requestSaveStatus,
  requests,
}: {
  activeStaffId?: string;
  assignments: ShiftAssignment;
  monthDates: Date[];
  renderedDateRangeLabel: string;
  targetPeriodLabel: string;
  requests: TimeOffRequest[];
  staff: Staff[];
  onDayClick: (dateKey: string) => void;
  onMemoChange: (dateKey: string, memo: string) => void;
  requestSaveMessage: string;
  requestSaveStatus: RequestSaveStatus;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} />
          <h2 className="text-lg font-semibold">希望休カレンダー</h2>
        </div>
        <div
          className={classNames(
            "rounded-md border px-3 py-1.5 text-sm",
            requestSaveStatus === "saving" && "border-neutral-200 bg-neutral-50 text-neutral-700",
            requestSaveStatus === "saved" && "border-teal-200 bg-teal-50 text-teal-800",
            requestSaveStatus === "error" && "border-rose-200 bg-rose-50 text-rose-900",
            requestSaveStatus === "idle" && "border-neutral-200 bg-neutral-50 text-neutral-600",
          )}
        >
          {requestSaveMessage}
        </div>
      </div>
      <div className="mb-3 space-y-1 text-sm font-medium text-neutral-700">
        <p>対象期間：{targetPeriodLabel}</p>
        <p>表示日付：{renderedDateRangeLabel}</p>
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
                  placeholder="メモ（自動保存）"
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
  isGeneratingShift: boolean;
  isLoading: boolean;
  monthDates: Date[];
  monthRequests: TimeOffRequest[];
  moveDraggedStaff: (dateKey: string) => void;
  renderedDateRangeLabel: string;
  required: RequiredStaff;
  setActiveTab: (tab: AdminTab) => void;
  setBulkValue: (value: number) => void;
  setBulkWeekdays: (weekdays: Weekday[]) => void;
  setDragStaffId: (id: string | null) => void;
  shiftIssues: Array<{ date: string; required: number; assigned: number }>;
  shiftSaveMessage: string;
  shiftSaveStatus: RequestSaveStatus;
  staff: Staff[];
  stats: Array<{ staffId: string; name: string; count: number }>;
  submittedStaffIds: Set<string>;
  targetMonth: string;
  targetPeriodLabel: string;
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
  isGeneratingShift,
  renderedDateRangeLabel,
  shiftIssues,
  staff,
  submittedStaffIds,
  targetMonth,
  targetPeriodLabel,
}: Parameters<typeof AdminView>[0]) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric label="スタッフ人数" value={`${staff.length}人`} />
        <Metric label="希望休提出" value={`${submittedStaffIds.size}/${staff.length}`} />
        <Metric label="対象月度" value={getMonthDegreeLabel(targetMonth)} />
        <Metric label="不足日" value={`${shiftIssues.length}日`} tone={shiftIssues.length ? "warn" : "ok"} />
      </div>
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold">対象期間</h2>
        <p className="mt-2 text-sm text-neutral-700">{targetPeriodLabel}</p>
        <p className="mt-1 text-sm font-medium text-neutral-700">表示日付：{renderedDateRangeLabel}</p>
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isGeneratingShift}
          onClick={createShift}
        >
          <Sparkles size={17} />
          {isGeneratingShift ? "自動作成中..." : "自動作成"}
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
  renderedDateRangeLabel,
  required,
  setBulkValue,
  setBulkWeekdays,
  targetPeriodLabel,
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
        <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm font-medium text-neutral-700 sm:col-span-2 lg:col-span-5">
          <p>対象期間：{targetPeriodLabel}</p>
          <p className="mt-1">表示日付：{renderedDateRangeLabel}</p>
        </div>
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

function RequestManager({ monthRequests, renderedDateRangeLabel, staff, targetPeriodLabel }: Parameters<typeof AdminView>[0]) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-semibold">希望休一覧</h2>
      <div className="mt-2 text-sm font-medium text-neutral-700">
        <p>対象期間：{targetPeriodLabel}</p>
        <p className="mt-1">表示日付：{renderedDateRangeLabel}</p>
      </div>
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
  isGeneratingShift,
  monthDates,
  moveDraggedStaff,
  renderedDateRangeLabel,
  required,
  setDragStaffId,
  shiftIssues,
  shiftSaveMessage,
  shiftSaveStatus,
  staff,
  stats,
  targetMonth,
  targetPeriodLabel,
  toggleAssignment,
}: Parameters<typeof AdminView>[0]) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isGeneratingShift}
          onClick={createShift}
        >
          <Sparkles size={16} />
          {isGeneratingShift ? "自動作成中..." : "自動作成"}
        </button>
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white" onClick={() => downloadShiftWorkbook(targetMonth, staff, assignments)}>
          <Download size={16} />
          Excel出力
        </button>
      </div>
      <div
        className={classNames(
          "rounded-md border px-4 py-3 text-sm font-medium",
          shiftSaveStatus === "saving" && "border-neutral-200 bg-white text-neutral-700",
          shiftSaveStatus === "saved" && "border-teal-200 bg-teal-50 text-teal-800",
          shiftSaveStatus === "error" && "border-rose-200 bg-rose-50 text-rose-900",
          shiftSaveStatus === "idle" && "border-neutral-200 bg-neutral-50 text-neutral-600",
        )}
      >
        {shiftSaveMessage}
      </div>
      <IssueList issues={shiftIssues} />
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm font-medium text-neutral-700">
        <p>対象期間：{targetPeriodLabel}</p>
        <p className="mt-1">表示日付：{renderedDateRangeLabel}</p>
      </div>
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
