import { useEffect, useMemo, useState } from "react";
import {
  getDisplayAuditStatus,
  getFilterCounts,
  matchesFilter,
} from "./douyinAuditStatus.js";

const rangeOptions = [
  { value: "last3", label: "最近 3 天", days: 3 },
  { value: "last7", label: "最近 7 天", days: 7 },
  { value: "last30", label: "最近 30 天", days: 30 },
  { value: "custom", label: "自定义日期" },
];
const filterOptions = [
  { value: "all", label: "全部" },
  { value: "human", label: "人工审核" },
  { value: "passed", label: "已通过" },
  { value: "failed", label: "失败" },
];
const SHOW_AUDIT_DEBUG = import.meta.env.DEV;
const AUDIT_BATCH_SIZE = 2;

export default function DouyinAuditPage({ user }) {
  const initialRange = getClientRange("last7");
  const [secUidInput, setSecUidInput] = useState("");
  const [rangeType, setRangeType] = useState("last7");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [accountTasks, setAccountTasks] = useState([]);
  const [accountProfiles, setAccountProfiles] = useState([]);
  const [accountProfileMeta, setAccountProfileMeta] = useState(null);
  const [accountListFile, setAccountListFile] = useState(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [selectedProfileUids, setSelectedProfileUids] = useState(new Set());
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [videos, setVideos] = useState([]);
  const [resultRange, setResultRange] = useState(null);
  const [totalFetched, setTotalFetched] = useState(0);
  const [responseMessage, setResponseMessage] = useState("");
  const [auditResults, setAuditResults] = useState({});
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditProgress, setAuditProgress] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [sortMode, setSortMode] = useState("time");
  const [isAuditing, setIsAuditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRestoringRun, setIsRestoringRun] = useState(false);
  const [isRunSaving, setIsRunSaving] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [runError, setRunError] = useState("");
  const [historyScope, setHistoryScope] = useState("mine");
  const canViewAllAuditRuns = user?.role === "admin" || user?.username === "admin";

  const recognizedSecUids = useMemo(
    () => parseSecUids(secUidInput),
    [secUidInput],
  );
  const accountProfileMap = useMemo(
    () =>
      new Map(
        accountProfiles.map((profile) => [String(profile.secUid), profile]),
      ),
    [accountProfiles],
  );
  const filteredAccountProfiles = useMemo(() => {
    const keyword = profileSearch.trim().toLowerCase();
    if (!keyword) return accountProfiles;
    return accountProfiles.filter((profile) =>
      [
        profile.frontend_name,
        profile.erp_name,
        profile.operator,
        profile.douyin_id,
        profile.secUid,
      ].some((value) => String(value || "").toLowerCase().includes(keyword)),
    );
  }, [accountProfiles, profileSearch]);

  useEffect(() => {
    loadAccountProfiles();
    loadLatestAuditRun();
    loadHistoryRuns();
  }, []);

  useEffect(() => {
    setAccountTasks((currentTasks) => {
      const currentBySecUid = new Map(
        currentTasks.map((task) => [task.secUid, task]),
      );
      return recognizedSecUids.map((secUid) => {
        const profile = accountProfileMap.get(secUid);
        const current = currentBySecUid.get(secUid);
        return current
          ? { ...current, ...getProfileTaskFields(profile) }
          : {
            secUid,
            ...getProfileTaskFields(profile),
            rangeType: "default",
            startDate: "",
            endDate: "",
            useCustomRange: false,
            status: "pending",
            message: "",
          };
      });
    });
  }, [recognizedSecUids, accountProfileMap]);
  const enrichedVideos = useMemo(
    () =>
      videos.map((video) => ({
        ...video,
        auditResult: auditResults[video.video_id] ?? null,
      })),
    [videos, auditResults],
  );
  const accountFilteredVideos = useMemo(
    () =>
      enrichedVideos.filter((video) => {
        if (selectedAccount !== "all" && video.secUid !== selectedAccount) {
          return false;
        }
        return !unmatchedOnly || !video.profile_matched;
      }),
    [
      enrichedVideos,
      selectedAccount,
      unmatchedOnly,
    ],
  );
  const filterCounts = useMemo(
    () => getFilterCounts(accountFilteredVideos),
    [accountFilteredVideos],
  );
  const visibleVideos = useMemo(() => {
    const filtered = accountFilteredVideos.filter((video) =>
      matchesFilter(video.auditResult, activeFilter),
    );
    return sortVideos(filtered, sortMode);
  }, [accountFilteredVideos, activeFilter, sortMode]);

  function selectRange(nextRangeType) {
    setRangeType(nextRangeType);
    if (nextRangeType !== "custom") {
      const nextRange = getClientRange(nextRangeType);
      setStartDate(nextRange.startDate);
      setEndDate(nextRange.endDate);
    }
  }

  function updateAccountTask(secUid, patch) {
    setAccountTasks((tasks) =>
      tasks.map((task) =>
        task.secUid === secUid
          ? {
              ...task,
              ...patch,
              status: "pending",
              message: "",
            }
          : task,
      ),
    );
  }

  function applyRangeToAll(nextRangeType) {
    setAccountTasks((tasks) =>
      tasks.map((task) => ({
        ...task,
        rangeType: nextRangeType,
        startDate: nextRangeType === "custom" ? task.startDate : "",
        endDate: nextRangeType === "custom" ? task.endDate : "",
        useCustomRange: nextRangeType === "custom",
        status: "pending",
        message: "",
      })),
    );
  }

  function removeAccountTask(secUid) {
    const remaining = recognizedSecUids.filter((value) => value !== secUid);
    setSecUidInput(remaining.join("\n"));
  }

  function clearAccounts() {
    setSecUidInput("");
    setAccountTasks([]);
    setAccounts([]);
    setVideos([]);
    setSelectedAccount("all");
  }

  async function loadAccountProfiles() {
    try {
      const response = await fetch("/api/audit/account-list");
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "账号资料库读取失败。");
      }
      setAccountProfiles(Array.isArray(payload?.accounts) ? payload.accounts : []);
      setAccountProfileMeta({
        imported_at: payload?.imported_at || "",
        source_file: payload?.source_file || "",
        stats: payload?.stats ?? {},
      });
      setProfileError("");
    } catch (requestError) {
      setProfileError(requestError.message || "账号资料库读取失败。");
    }
  }

  async function loadLatestAuditRun() {
    setIsRestoringRun(true);
    try {
      const response = await fetch("/api/audit/runs/latest?scope=mine");
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getAuditRunApiError(response, payload, "最近质检记录读取失败。"));
      }

      if (payload?.run) {
        restoreAuditRun(payload.run, { auto: true });
      }
    } catch (requestError) {
      setRunError(requestError.message || "最近质检记录读取失败。");
    } finally {
      setIsRestoringRun(false);
    }
  }

  async function loadHistoryRuns(scope = historyScope) {
    const safeScope = canViewAllAuditRuns && scope === "all" ? "all" : "mine";
    try {
      const response = await fetch(
        `/api/audit/runs?scope=${safeScope}&limit=20`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getAuditRunApiError(response, payload, "质检历史读取失败。"));
      }
      setHistoryRuns(Array.isArray(payload?.runs) ? payload.runs : []);
    } catch (requestError) {
      setRunError(requestError.message || "质检历史读取失败。");
    }
  }

  function restoreAuditRun(run, { auto = false } = {}) {
    const defaultRange = normalizeRestoredRange(run.defaultRange);
    const restoredTasks = normalizeRestoredTasks(run.accountTasks);
    const restoredAccounts = Array.isArray(run.accounts) ? run.accounts : [];
    const restoredVideos = Array.isArray(run.videos) ? run.videos : [];
    const restoredResults = normalizeAuditResultsMap(run.auditResults);
    const restoredSummary = run.summary?.auditSummary ?? null;

    setCurrentRunId(run.id ?? null);
    setRangeType(defaultRange.rangeType);
    setStartDate(defaultRange.startDate);
    setEndDate(defaultRange.endDate);
    setSecUidInput(restoredTasks.map((task) => task.secUid).filter(Boolean).join("\n"));
    setAccountTasks(restoredTasks);
    setAccounts(restoredAccounts);
    setVideos(restoredVideos);
    setAuditResults(restoredResults);
    setAuditSummary(restoredSummary);
    setResultRange(run.summary?.resultRange ?? defaultRange);
    setTotalFetched(Number(run.summary?.totalFetched) || restoredVideos.length);
    setResponseMessage("");
    setError("");
    setAuditError("");
    setActiveFilter("all");
    setSelectedAccount("all");
    setUnmatchedOnly(false);
    setHasSearched(restoredVideos.length > 0 || restoredAccounts.length > 0);
    setRunError("");
    setRunMessage(
      auto
        ? `已自动恢复最近一次质检记录：${run.title}`
        : "已恢复历史质检记录。",
    );

    if (!auto) {
      setTimeout(() => {
        document.querySelector(".douyin-workbench")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 120);
    }
  }

  async function restoreHistoryRun(runId) {
    setIsRestoringRun(true);
    try {
      const response = await fetch(`/api/audit/runs/${encodeURIComponent(runId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getAuditRunApiError(response, payload, "质检记录恢复失败。"));
      }
      restoreAuditRun(payload.run);
      setIsHistoryOpen(false);
    } catch (requestError) {
      setRunError(requestError.message || "质检记录恢复失败。");
    } finally {
      setIsRestoringRun(false);
    }
  }

  async function deleteHistoryRun(runId) {
    if (!window.confirm("确定删除这条质检记录吗？删除后不可恢复。")) return;

    try {
      const response = await fetch(`/api/audit/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getAuditRunApiError(response, payload, "质检记录删除失败。"));
      }
      if (currentRunId === runId) {
        setCurrentRunId(null);
      }
      setHistoryRuns((runs) => runs.filter((run) => run.id !== runId));
      setRunMessage("质检记录已删除。");
    } catch (requestError) {
      setRunError(requestError.message || "质检记录删除失败。");
    }
  }

  async function saveAuditRun(status = "fetched", overrides = {}) {
    const nextVideos = overrides.videos ?? videos;
    const nextAccounts = overrides.accounts ?? accounts;
    const nextAuditResults = overrides.auditResults ?? auditResults;
    const nextAuditSummary =
      Object.hasOwn(overrides, "auditSummary")
        ? overrides.auditSummary
        : auditSummary;
    const nextDefaultRange =
      overrides.defaultRange ?? { rangeType, startDate, endDate };
    const nextAccountTasks = overrides.accountTasks ?? accountTasks;

    if (
      !overrides.force &&
      nextVideos.length === 0 &&
      Object.keys(nextAuditResults).length === 0
    ) {
      setRunError("当前还没有可保存的质检数据。");
      return null;
    }

    setIsRunSaving(true);
    setRunError("");
    try {
      const response = await fetch("/api/audit/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: overrides.id ?? currentRunId,
          title:
            overrides.title ??
            buildAuditRunTitle(nextAccounts.length, nextVideos.length),
          defaultRange: nextDefaultRange,
          accountTasks: nextAccountTasks,
          accounts: nextAccounts,
          videos: nextVideos,
          auditResults: nextAuditResults,
          summary: buildPersistedRunSummary({
            accounts: nextAccounts,
            videos: nextVideos,
            auditResults: nextAuditResults,
            auditSummary: nextAuditSummary,
            resultRange: overrides.resultRange ?? resultRange ?? nextDefaultRange,
            totalFetched: overrides.totalFetched ?? totalFetched,
          }),
          status,
          note: overrides.note ?? "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getAuditRunApiError(response, payload, "质检记录保存失败。"));
      }
      setCurrentRunId(payload.run.id);
      setRunMessage(overrides.message ?? "当前质检记录已保存。");
      await loadHistoryRuns();
      return payload.run;
    } catch (requestError) {
      setRunError(requestError.message || "质检记录保存失败。");
      return null;
    } finally {
      setIsRunSaving(false);
    }
  }

  function clearCurrentPage() {
    setCurrentRunId(null);
    setSecUidInput("");
    setAccountTasks([]);
    setAccounts([]);
    setVideos([]);
    setResultRange(null);
    setTotalFetched(0);
    setResponseMessage("");
    setAuditResults({});
    setAuditSummary(null);
    setAuditProgress(null);
    setActiveFilter("all");
    setSelectedAccount("all");
    setUnmatchedOnly(false);
    setSortMode("time");
    setError("");
    setAuditError("");
    setRunError("");
    setRunMessage("当前页面已清空，历史记录不会被删除。");
    setHasSearched(false);
  }

  async function handleAccountListUpload() {
    if (!accountListFile || isProfileLoading) {
      setProfileError("请选择 .xlsx 质检名单。");
      return;
    }

    setIsProfileLoading(true);
    setProfileError("");
    try {
      const formData = new FormData();
      formData.append("file", accountListFile);
      const response = await fetch("/api/audit/account-list/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "质检名单上传失败。");
      }
      setAccountProfiles(Array.isArray(payload?.accounts) ? payload.accounts : []);
      setAccountProfileMeta({
        imported_at: payload?.imported_at || "",
        source_file: payload?.source_file || accountListFile.name,
        stats: payload?.stats ?? {},
      });
      setSelectedProfileUids(new Set());
      setAccountListFile(null);
    } catch (requestError) {
      setProfileError(requestError.message || "质检名单上传失败。");
    } finally {
      setIsProfileLoading(false);
    }
  }

  function toggleProfileSelection(secUid) {
    setSelectedProfileUids((current) => {
      const next = new Set(current);
      if (next.has(secUid)) next.delete(secUid);
      else next.add(secUid);
      return next;
    });
  }

  function selectVisibleProfiles() {
    setSelectedProfileUids(
      new Set(filteredAccountProfiles.map((profile) => profile.secUid)),
    );
  }

  function addProfilesToTasks(profiles) {
    const merged = [
      ...recognizedSecUids,
      ...profiles.map((profile) => profile.secUid),
    ];
    const unique = [...new Set(merged)].slice(0, 10);
    setSecUidInput(unique.join("\n"));
    if (merged.length > 10) {
      setProfileError("一次最多支持 10 个账号，已添加前 10 个。");
    } else {
      setProfileError("");
    }
  }

  function addSelectedProfiles() {
    addProfilesToTasks(
      accountProfiles.filter((profile) => selectedProfileUids.has(profile.secUid)),
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (recognizedSecUids.length === 0) {
      setError("请填写至少一个抖音账号 secUid。");
      return;
    }

    if (recognizedSecUids.length > 10) {
      setError("一次最多支持 10 个抖音账号。");
      return;
    }

    const invalidCustomTask = accountTasks.find(
      (task) =>
        task.rangeType === "custom" &&
        (!task.startDate ||
          !task.endDate ||
          task.startDate > task.endDate),
    );

    if (invalidCustomTask) {
      setError(
        `账号 ${shortSecUid(invalidCustomTask.secUid)} 的自定义日期不完整或顺序不正确。`,
      );
      return;
    }

    if (!startDate || !endDate || startDate > endDate) {
      setError("请选择有效的开始日期和结束日期。");
      return;
    }

    const requestedRange =
      rangeType === "custom"
        ? { rangeType, startDate, endDate }
        : getClientRange(rangeType);

    setIsLoading(true);
    setError("");
    setVideos([]);
    setAccounts([]);
    setAuditResults({});
    setAuditSummary(null);
    setAuditProgress(null);
    setAuditError("");
    setResponseMessage("");
    setTotalFetched(0);
    setActiveFilter("all");
    setSelectedAccount("all");
    setUnmatchedOnly(false);
    setHasSearched(true);
    setAccountTasks((tasks) =>
      tasks.map((task) => ({ ...task, status: "loading", message: "" })),
    );

    try {
      const response = await fetch("/api/audit/douyin-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultRange: requestedRange,
          accountTasks: accountTasks.map((task) =>
            task.rangeType === "default"
              ? {
                  secUid: task.secUid,
                  ...getProfileTaskFields(task),
                  rangeType: "followDefault",
                  startDate: "",
                  endDate: "",
                }
              : {
                  secUid: task.secUid,
                  ...getProfileTaskFields(task),
                  rangeType: task.rangeType,
                  startDate: task.startDate,
                  endDate: task.endDate,
                },
          ),
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "视频数据获取失败，请稍后重试。");
      }

      const nextVideos = Array.isArray(payload?.videos) ? payload.videos : [];
      const nextAccounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
      const nextResultRange = payload?.defaultRange ?? requestedRange;
      const nextTotalFetched = Number(payload?.totalFetched) || 0;
      setVideos(nextVideos);
      setAccounts(nextAccounts);
      setResultRange(nextResultRange);
      setTotalFetched(nextTotalFetched);
      setResponseMessage(payload?.message || "");
      const accountsBySecUid = new Map(
        (payload?.accounts ?? []).map((account) => [
          normalizeClientSecUid(account.secUid),
          account,
        ]),
      );
      setAccountTasks((tasks) =>
        tasks.map((task) => {
          const account = accountsBySecUid.get(
            normalizeClientSecUid(task.secUid),
          );
          return {
            ...task,
            ...(account ? getProfileTaskFields(account) : {}),
            status: account?.status ?? "failed",
            message:
              account?.message ||
              (account
                ? ""
                : "后端未返回该账号结果，请检查 secUid 是否包含异常字符"),
          };
        }),
      );
      const nextAccountTasks = accountTasks.map((task) => {
        const account = accountsBySecUid.get(normalizeClientSecUid(task.secUid));
        return {
          ...task,
          ...(account ? getProfileTaskFields(account) : {}),
          status: account?.status ?? "failed",
          message:
            account?.message ||
            (account
              ? ""
              : "后端未返回该账号结果，请检查 secUid 是否包含异常字符"),
        };
      });
      await saveAuditRun("fetched", {
        defaultRange: nextResultRange,
        accountTasks: nextAccountTasks,
        accounts: nextAccounts,
        videos: nextVideos,
        auditResults: {},
        auditSummary: null,
        resultRange: nextResultRange,
        totalFetched: nextTotalFetched,
        message: "账号作品已获取并保存为质检记录。",
      });
    } catch (requestError) {
      setError(requestError.message || "视频数据获取失败，请稍后重试。");
      setAccountTasks((tasks) =>
        tasks.map((task) => ({
          ...task,
          status: "failed",
          message: requestError.message || "获取失败",
        })),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAiAudit() {
    if (visibleVideos.length === 0 || isAuditing) return;

    const auditVideos = visibleVideos.map(
      ({ auditResult: _auditResult, ...video }) => video,
    );
    const totalBatches = Math.ceil(auditVideos.length / AUDIT_BATCH_SIZE);
    setIsAuditing(true);
    setAuditError("");
    setAuditResults({});
    setAuditSummary(null);
    setAuditProgress({
      completed: 0,
      total: auditVideos.length,
      currentBatch: 1,
      totalBatches,
    });

    await saveAuditRun("auditing", {
      auditResults: {},
      auditSummary: null,
      message: "AI 质检已开始，当前记录已更新。",
      note: "AI 质检中",
    });

    const allResults = [];
    let localMatchedCount = 0;
    let visionCount = 0;
    let textFallbackCount = 0;

    try {
      for (let index = 0; index < auditVideos.length; index += AUDIT_BATCH_SIZE) {
        const currentBatch = Math.floor(index / AUDIT_BATCH_SIZE) + 1;
        const batch = auditVideos.slice(index, index + AUDIT_BATCH_SIZE);
        setAuditProgress({
          completed: allResults.length,
          total: auditVideos.length,
          currentBatch,
          totalBatches,
        });
        const response = await fetch("/api/audit/douyin-videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videos: batch }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || payload?.success === false) {
          throw new Error(
            payload?.details?.detail ||
              payload?.message ||
              "AI 质检失败，请稍后重试。",
          );
        }

        const batchResults = Array.isArray(payload?.results)
          ? payload.results
          : [];
        allResults.push(...batchResults);
        localMatchedCount += Number(payload?.local_matched_count) || 0;
        visionCount += Number(payload?.vision_count) || 0;
        textFallbackCount += Number(payload?.text_fallback_count) || 0;
        setAuditResults((current) => ({
          ...current,
          ...Object.fromEntries(
            batchResults
              .filter((result) => result?.video_id)
              .map((result) => [result.video_id, result]),
          ),
        }));
        setAuditProgress({
          completed: allResults.length,
          total: auditVideos.length,
          currentBatch,
          totalBatches,
        });
      }

      const nextAuditSummary = {
        ...getAuditSummary(allResults),
        localMatchedCount,
        visionCount,
        textFallbackCount,
      };
      const nextAuditResults = Object.fromEntries(
        allResults
          .filter((result) => result?.video_id)
          .map((result) => [result.video_id, result]),
      );
      setAuditSummary(nextAuditSummary);
      setAuditProgress({
        completed: allResults.length,
        total: auditVideos.length,
        currentBatch: totalBatches,
        totalBatches,
      });
      await saveAuditRun("completed", {
        auditResults: nextAuditResults,
        auditSummary: nextAuditSummary,
        message: "AI 质检结果已保存。",
      });
    } catch (requestError) {
      const message = requestError.message || "AI 质检失败，请稍后重试。";
      setAuditError(message);
      await saveAuditRun("failed", {
        auditResults: Object.fromEntries(
          allResults
            .filter((result) => result?.video_id)
            .map((result) => [result.video_id, result]),
        ),
        auditSummary:
          allResults.length > 0
            ? {
                ...getAuditSummary(allResults),
                localMatchedCount,
                visionCount,
                textFallbackCount,
              }
            : null,
        note: message,
        message: "AI 质检失败，已保存当前进度。",
      });
    } finally {
      setIsAuditing(false);
    }
  }

  function exportCurrentResults() {
    if (visibleVideos.length === 0) return;

    const rows = [
      [
        "前端名称",
        "ERP名称",
        "运营/编剪",
        "抖音号",
        "secUid",
        "发布时间",
        "视频链接",
        "审核结论",
        "是否人工审核",
        "主要问题",
        "证据摘要",
        "审核建议",
        "原始模型结论",
        "原始风险等级",
        "质检模式",
      ],
      ...visibleVideos.map(({ auditResult, ...video }) => [
        video.frontend_name,
        video.erp_name,
        video.operator,
        video.douyin_id,
        video.secUid,
        video.create_time,
        video.page_url,
        getDisplayAuditStatus(auditResult).label,
        getDisplayAuditStatus(auditResult).key === "human" ? "是" : "否",
        joinValues(auditResult?.main_risks) ||
          auditResult?.problem_description ||
          "",
        buildEvidenceSummary(auditResult),
        auditResult?.rectification_suggestion || "",
        auditResult?.audit_result || "未质检",
        auditResult?.risk_level || "",
        getAuditModeLabel(auditResult?.audit_mode),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `抖音质检结果_${formatLocalDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyCurrentSummary() {
    if (visibleVideos.length === 0) return;

    const text = visibleVideos
      .map(({ auditResult, ...video }, index) =>
        [
          `${index + 1}. ${video.frontend_name || video.author_name || "未知账号"}｜${video.create_time}`,
          `视频：${video.page_url}`,
          `结论：${getDisplayAuditStatus(auditResult).label}`,
          `主要风险：${joinValues(auditResult?.main_risks) || "无"}`,
          `审核建议：${auditResult?.rectification_suggestion || "无"}`,
        ].join("\n"),
      )
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(`已复制 ${visibleVideos.length} 条摘要`);
      setTimeout(() => setCopyMessage(""), 2200);
    } catch {
      setCopyMessage("复制失败，请检查浏览器剪贴板权限");
    }
  }

  const overview = {
    accounts: accounts.length,
    successAccounts: accounts.filter((account) => account.status === "success")
      .length,
    failedAccounts: accounts.filter((account) => account.status === "failed")
      .length,
    videos: videos.length,
    passed: filterCounts.passed,
    human: filterCounts.human,
    failed: filterCounts.failed,
  };

  return (
    <div className="page-content douyin-audit-page">
      <header className="page-heading douyin-audit-heading">
        <span className="eyebrow">DOUYIN QUALITY WORKSPACE</span>
        <h1>抖音短视频质检</h1>
        <p>支持多账号、日期筛选、AI 视觉质检和人工复核筛选。</p>
        <div className="douyin-run-actions">
          <button
            type="button"
            onClick={() => {
              setIsHistoryOpen(true);
              loadHistoryRuns(historyScope);
            }}
          >
            查看历史记录
          </button>
          <button
            type="button"
            onClick={() =>
              saveAuditRun(
                Object.keys(auditResults).length > 0 ? "completed" : "fetched",
                { message: "当前质检记录已保存。" },
              )
            }
            disabled={isRunSaving || (videos.length === 0 && Object.keys(auditResults).length === 0)}
          >
            {isRunSaving ? "保存中..." : "保存当前记录"}
          </button>
          <button type="button" className="danger" onClick={clearCurrentPage}>
            清空当前页面
          </button>
        </div>
      </header>

      {runMessage && (
        <div className="douyin-run-message success">
          <strong>{runMessage}</strong>
          <span>你可以继续 AI 质检、导出结果，或清空后重新开始。</span>
        </div>
      )}
      {runError && (
        <div className="douyin-run-message error">
          <strong>{runError}</strong>
        </div>
      )}
      {isRestoringRun && (
        <div className="douyin-run-message neutral">
          <strong>正在读取质检记录...</strong>
        </div>
      )}

      <form className="douyin-audit-form douyin-query-card" onSubmit={handleSubmit}>
        <div className="douyin-query-intro">
          <span className="card-kicker">01 / 查询条件</span>
          <h2>批量获取账号作品</h2>
          <p>
            支持多个抖音账号批量抓取。可统一设置默认日期，也可为每个账号单独设置发布时间范围。
          </p>
        </div>

        <div className="douyin-audit-controls">
          <section className="douyin-profile-library">
            <div className="douyin-profile-header">
              <div>
                <span className="card-kicker">质检名单</span>
                <h3>账号资料库</h3>
                <p>
                  上传账号名单后，系统会自动根据 UID 匹配店铺名称、ERP、运营和抖音号，方便批量质检时识别账号。
                </p>
              </div>
              <div className="douyin-profile-upload">
                <label>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) =>
                      setAccountListFile(event.target.files?.[0] ?? null)
                    }
                    disabled={isProfileLoading}
                  />
                  <span>
                    {accountListFile?.name || "选择质检名单 Excel"}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={handleAccountListUpload}
                  disabled={!accountListFile || isProfileLoading}
                >
                  {isProfileLoading ? "正在导入..." : "上传质检名单 Excel"}
                </button>
              </div>
            </div>

            {profileError && <p className="douyin-profile-error">{profileError}</p>}

            {accountProfiles.length > 0 ? (
              <>
                <div className="douyin-profile-stats">
                  <span>已导入账号 <strong>{accountProfiles.length}</strong></span>
                  <span>
                    有效 UID <strong>{accountProfileMeta?.stats?.valid_uid_count ?? accountProfiles.length}</strong>
                  </span>
                  <span>
                    缺失 UID <strong>{accountProfileMeta?.stats?.missing_uid_count ?? 0}</strong>
                  </span>
                  <span>
                    重复 UID <strong>{accountProfileMeta?.stats?.duplicate_uid_count ?? 0}</strong>
                  </span>
                  <span>
                    最近上传{" "}
                    <strong>{formatImportedTime(accountProfileMeta?.imported_at)}</strong>
                  </span>
                </div>

                <div className="douyin-profile-tools">
                  <input
                    type="search"
                    value={profileSearch}
                    onChange={(event) => setProfileSearch(event.target.value)}
                    placeholder="搜索店铺名称、ERP名称、运营、抖音号或 secUid"
                  />
                  <div>
                    <button type="button" onClick={selectVisibleProfiles}>
                      全选当前筛选账号
                    </button>
                    <button
                      type="button"
                      onClick={addSelectedProfiles}
                      disabled={selectedProfileUids.size === 0}
                    >
                      添加到质检任务
                    </button>
                    <button type="button" className="danger" onClick={clearAccounts}>
                      清空任务
                    </button>
                  </div>
                </div>

                <div className="douyin-profile-list">
                  <div className="douyin-profile-columns" aria-hidden="true">
                    <span />
                    <span>前端名称</span>
                    <span>ERP名称</span>
                    <span>运营/编剪</span>
                    <span>抖音号</span>
                    <span>secUid</span>
                  </div>
                  {filteredAccountProfiles.map((profile) => (
                    <label className="douyin-profile-row" key={profile.secUid}>
                      <input
                        type="checkbox"
                        checked={selectedProfileUids.has(profile.secUid)}
                        onChange={() => toggleProfileSelection(profile.secUid)}
                      />
                      <strong className="douyin-profile-name">
                        {profile.frontend_name || "未命名账号"}
                      </strong>
                      <span>{profile.erp_name || "ERP 未填写"}</span>
                      <span>{profile.operator || "运营未填写"}</span>
                      <span>{profile.douyin_id || "抖音号未填写"}</span>
                      <code title={profile.secUid}>{shortSecUid(profile.secUid)}</code>
                    </label>
                  ))}
                  {filteredAccountProfiles.length === 0 && (
                    <div className="douyin-profile-empty">没有匹配的账号资料。</div>
                  )}
                </div>
              </>
            ) : (
              <div className="douyin-profile-empty">
                还未上传质检名单。上传后可直接从名单选择账号生成质检任务。
              </div>
            )}
          </section>

          <label className="douyin-secuid-field">
            <span>抖音账号 secUid</span>
            <textarea
              value={secUidInput}
              onChange={(event) => setSecUidInput(event.target.value)}
              placeholder={
                "一行一个 secUid，也支持逗号、空格分隔\n例如：\nMS4wLjABAAAAxxx\nMS4wLjABAAAAyyy"
              }
              disabled={isLoading}
              rows={5}
            />
            <small className={recognizedSecUids.length > 10 ? "invalid" : ""}>
              已识别 {recognizedSecUids.length} 个账号
              {recognizedSecUids.length > 10 ? "，请减少到 10 个以内" : ""}
            </small>
          </label>

          <fieldset className="douyin-range-field">
            <legend>默认发布时间范围</legend>
            <div className="douyin-range-options">
              {rangeOptions.map((option) => (
                <button
                  className={rangeType === option.value ? "active" : ""}
                  type="button"
                  key={option.value}
                  onClick={() => selectRange(option.value)}
                  disabled={isLoading}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="douyin-default-range-help">
              默认范围会应用到所有账号；你也可以在下方账号任务列表中单独修改某个账号的日期范围。
            </p>
          </fieldset>

          {rangeType === "custom" && (
            <div className="douyin-custom-dates">
              <label>
                <span>开始日期</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  disabled={isLoading}
                />
              </label>
              <span aria-hidden="true">至</span>
              <label>
                <span>结束日期</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  disabled={isLoading}
                />
              </label>
            </div>
          )}

          <section className="douyin-account-tasks">
            <div className="douyin-task-heading">
              <div>
                <strong>账号任务列表</strong>
                <span>{accountTasks.length} 个任务</span>
              </div>
              <div className="douyin-task-shortcuts">
                <button type="button" onClick={() => applyRangeToAll("last3")}>
                  全部最近3天
                </button>
                <button type="button" onClick={() => applyRangeToAll("last7")}>
                  全部最近7天
                </button>
                <button type="button" onClick={() => applyRangeToAll("last30")}>
                  全部最近30天
                </button>
                <button type="button" onClick={() => applyRangeToAll("default")}>
                  全部跟随默认
                </button>
                <button type="button" className="danger" onClick={clearAccounts}>
                  清空账号
                </button>
              </div>
            </div>

            {accountTasks.length === 0 ? (
              <div className="douyin-task-empty">
                输入 secUid 后，将在这里生成账号任务。你可以为每个账号单独设置日期范围。
              </div>
            ) : (
              <div className="douyin-task-list">
                {accountTasks.map((task, index) => (
                  <article className="douyin-task-row" key={task.secUid}>
                    <span className="douyin-task-index">#{index + 1}</span>
                    <div className="douyin-task-profile">
                      {task.profile_matched ? (
                        <>
                          <strong>{task.frontend_name || task.erp_name}</strong>
                          <span>ERP：{task.erp_name || "未填写"}</span>
                          <span>运营：{task.operator || "未填写"}</span>
                          <span>抖音号：{task.douyin_id || "未填写"}</span>
                        </>
                      ) : (
                        <strong className="unmatched">未匹配到账号资料</strong>
                      )}
                      <code title={task.secUid}>
                        secUid：{shortSecUid(task.secUid)}
                      </code>
                    </div>
                    <select
                      value={task.rangeType}
                      onChange={(event) =>
                        updateAccountTask(task.secUid, {
                          rangeType: event.target.value,
                          useCustomRange: event.target.value === "custom",
                        })
                      }
                      disabled={isLoading}
                    >
                      <option value="default">跟随默认</option>
                      <option value="last3">最近3天</option>
                      <option value="last7">最近7天</option>
                      <option value="last30">最近30天</option>
                      <option value="custom">自定义日期</option>
                    </select>
                    {task.rangeType === "custom" ? (
                      <div className="douyin-task-dates">
                        <input
                          type="date"
                          value={task.startDate}
                          onChange={(event) =>
                            updateAccountTask(task.secUid, {
                              startDate: event.target.value,
                            })
                          }
                          disabled={isLoading}
                        />
                        <span>至</span>
                        <input
                          type="date"
                          value={task.endDate}
                          onChange={(event) =>
                            updateAccountTask(task.secUid, {
                              endDate: event.target.value,
                            })
                          }
                          disabled={isLoading}
                        />
                      </div>
                    ) : (
                      <span className="douyin-task-range-label">
                        {getTaskDisplayRange(task, {
                          rangeType,
                          startDate,
                          endDate,
                        })}
                      </span>
                    )}
                    <span className={`douyin-task-status ${task.status}`}>
                      {getTaskStatusLabel(task.status)}
                    </span>
                    <button
                      className="douyin-task-delete"
                      type="button"
                      onClick={() => removeAccountTask(task.secUid)}
                      disabled={isLoading}
                    >
                      删除
                    </button>
                    {task.message && (
                      <small>
                        {task.status === "failed" ? "视频获取失败：" : ""}
                        {task.message}
                      </small>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="douyin-query-actions">
            <button
              className="douyin-fetch-button"
              type="submit"
              disabled={
                isLoading ||
                recognizedSecUids.length === 0 ||
                recognizedSecUids.length > 10
              }
            >
              {isLoading ? "正在按账号顺序获取..." : "获取账号作品"}
            </button>
            <button
              className="douyin-ai-audit-button"
              type="button"
              onClick={handleAiAudit}
              disabled={isLoading || isAuditing || visibleVideos.length === 0}
            >
              {isAuditing ? "AI 质检中..." : "开始 AI 质检"}
            </button>
          </div>
        </div>
      </form>

      {error && <ErrorBox title="获取失败" message={error} />}
      {auditError && <ErrorBox title="AI 质检失败" message={auditError} />}

      {(videos.length > 0 || hasSearched) && (
        <section className="douyin-overview-section">
          <div className="douyin-section-title">
            <div>
              <span className="card-kicker">02 / 统计概览</span>
              <h2>本次质检工作台</h2>
            </div>
            {resultRange && (
              <span className="douyin-range-inline">
                {getRangeLabel(resultRange.rangeType)} · {resultRange.startDate} 至{" "}
                {resultRange.endDate}
              </span>
            )}
          </div>
          <div className="douyin-overview-grid">
            <OverviewCard label="账号数" value={overview.accounts} />
            <OverviewCard
              label="成功账号"
              value={overview.successAccounts}
              tone="passed"
            />
            <OverviewCard
              label="失败账号"
              value={overview.failedAccounts}
              tone="failed"
            />
            <OverviewCard label="视频总数" value={overview.videos} />
            <OverviewCard label="已通过" value={overview.passed} tone="passed" />
            <OverviewCard label="人工审核" value={overview.human} tone="human" />
            <OverviewCard label="失败" value={overview.failed} tone="failed" />
          </div>
          {accounts.length > 0 && (
            <div className="douyin-account-strip">
              {accounts.map((account, index) => (
                <span className={account.status} key={account.secUid}>
                  {index + 1}.{" "}
                  {account.frontend_name ||
                    account.author_name ||
                    shortSecUid(account.secUid)}{" "}
                  ·{" "}
                  {account.range_label} ·{" "}
                  {account.status === "success"
                    ? `${account.count} 条`
                    : `失败：${account.message}`}
                </span>
              ))}
              <small>抓取去重共 {totalFetched} 条原始作品</small>
            </div>
          )}
        </section>
      )}

      {isAuditing && auditProgress && (
        <section className="douyin-audit-progress">
          <div>
            <strong>质检中</strong>
            <span>
              已完成 {auditProgress.completed} / {auditProgress.total}
            </span>
          </div>
          <div className="douyin-progress-track">
            <span
              style={{
                width: `${Math.max(
                  4,
                  (auditProgress.completed / auditProgress.total) * 100,
                )}%`,
              }}
            />
          </div>
          <p>
            当前第 {auditProgress.currentBatch} 批 / 共{" "}
            {auditProgress.totalBatches} 批。系统将按每批 2 条顺序质检，单条最多等待 90 秒，请勿关闭页面。
          </p>
        </section>
      )}

      {videos.length > 0 && (
        <section className="douyin-workbench">
          <div className="douyin-section-title">
            <div>
              <span className="card-kicker">03 / 人工审核工作台</span>
              <h2>筛选与处理</h2>
            </div>
            <span className="douyin-count-badge">当前展示 {visibleVideos.length} 条</span>
          </div>

          <div className="douyin-filter-toolbar">
            <div className="douyin-filter-buttons">
              {filterOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={activeFilter === option.value ? "active" : ""}
                  onClick={() => setActiveFilter(option.value)}
                >
                  {option.label} {filterCounts[option.value]}
                </button>
              ))}
            </div>
            <div className="douyin-toolbar-selects">
              <label className="douyin-sort-control">
                <span>账号</span>
                <select
                  value={selectedAccount}
                  onChange={(event) => {
                    setSelectedAccount(event.target.value);
                    setActiveFilter("all");
                  }}
                >
                  <option value="all">全部账号</option>
                  {accounts.map((account) => (
                    <option
                      value={account.secUid}
                      key={account.secUid}
                    >
                      {account.frontend_name ||
                        account.author_name ||
                        shortSecUid(account.secUid)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="douyin-unmatched-filter">
                <input
                  type="checkbox"
                  checked={unmatchedOnly}
                  onChange={(event) => setUnmatchedOnly(event.target.checked)}
                />
                只看未匹配名单账号
              </label>
              <label className="douyin-sort-control">
                <span>排序</span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value)}
                >
                  <option value="time">发布时间倒序</option>
                  <option value="risk">风险优先</option>
                  <option value="human">人工审核优先</option>
                  <option value="account">账号分组</option>
                </select>
              </label>
            </div>
          </div>

          <div className="douyin-batch-actions">
            <button type="button" onClick={() => setActiveFilter("human")}>
              只看人工审核
            </button>
            <button type="button" onClick={exportCurrentResults}>
              导出当前结果 CSV
            </button>
            <button type="button" onClick={copyCurrentSummary}>
              复制当前结果摘要
            </button>
            {copyMessage && <span>{copyMessage}</span>}
          </div>

          {auditSummary && (
            <div className="douyin-audit-summary">
              <span>通过 {auditSummary.passed ?? 0} 条</span>
              <span>人工审核 {auditSummary.humanReview ?? 0} 条</span>
              <span>失败 {auditSummary.failed ?? 0} 条</span>
              <span>视觉质检 {auditSummary.visionCount} 条</span>
              <span>文本降级 {auditSummary.textFallbackCount} 条</span>
              <span>本地规则命中 {auditSummary.localMatchedCount} 条</span>
            </div>
          )}

          {visibleVideos.length > 0 ? (
            <div className="douyin-video-grid compact">
              {visibleVideos.map((video) => (
                <DouyinVideoCard
                  key={`${video.secUid}-${video.video_id}`}
                  video={video}
                  auditResult={video.auditResult}
                  isAuditing={isAuditing}
                />
              ))}
            </div>
          ) : (
            <div className="douyin-audit-empty compact">
              <strong>当前筛选条件下没有视频</strong>
              <p>可以切换其他质检状态查看。</p>
            </div>
          )}
        </section>
      )}

      {isLoading && (
        <div className="douyin-audit-empty">
          <span className="douyin-empty-icon loading" aria-hidden="true">DY</span>
          <strong>正在按顺序获取多个账号作品</strong>
          <p>每个账号会独立分页读取，请稍候。</p>
        </div>
      )}

      {!isLoading && !error && videos.length === 0 && (
        <div className="douyin-audit-empty">
          <span className="douyin-empty-icon" aria-hidden="true">DY</span>
          <strong>{hasSearched ? "暂时没有可展示的作品" : "等待获取作品"}</strong>
          <p>
            {hasSearched
              ? responseMessage || "该时间范围内未获取到视频。"
            : "输入一个或多个 secUid，选择日期范围后开始获取。"}
          </p>
        </div>
      )}

      {isHistoryOpen && (
        <div className="douyin-history-drawer" role="dialog" aria-modal="true">
          <button
            className="douyin-history-backdrop"
            type="button"
            aria-label="关闭历史记录"
            onClick={() => setIsHistoryOpen(false)}
          />
          <aside className="douyin-history-panel">
            <header>
              <div>
                <span className="card-kicker">AUDIT RUN HISTORY</span>
                <h2>质检历史记录</h2>
                <p>可恢复之前的账号任务、视频列表和 AI 质检结果。</p>
              </div>
              <button type="button" onClick={() => setIsHistoryOpen(false)}>
                关闭
              </button>
            </header>

            <div className="douyin-history-scope">
              <button
                type="button"
                className={historyScope === "mine" ? "active" : ""}
                onClick={() => {
                  setHistoryScope("mine");
                  loadHistoryRuns("mine");
                }}
              >
                我的记录
              </button>
              {canViewAllAuditRuns && (
                <button
                  type="button"
                  className={historyScope === "all" ? "active" : ""}
                  onClick={() => {
                    setHistoryScope("all");
                    loadHistoryRuns("all");
                  }}
                >
                  全部记录
                </button>
              )}
            </div>

            {historyRuns.length === 0 ? (
              <div className="douyin-history-empty">
                还没有保存过质检记录。获取账号作品后会自动保存。
              </div>
            ) : (
              <div className="douyin-history-list">
                {historyRuns.map((run) => (
                  <article className="douyin-history-run" key={run.id}>
                    <div>
                      <strong>{run.title}</strong>
                      <span>
                        创建：{formatRunTime(run.created_at)}｜更新：{formatRunTime(run.updated_at)}
                      </span>
                      <span>创建人：{run.created_by_name || "未知创建人"}</span>
                    </div>
                    <div className="douyin-history-meta">
                      <span className={`status ${run.status}`}>
                        {getRunStatusLabel(run.status)}
                      </span>
                      <span>账号 {run.account_count}</span>
                      <span>视频 {run.video_count}</span>
                      <span>人工 {getRunSummaryCounts(run.summary).humanReview}</span>
                      <span>通过 {getRunSummaryCounts(run.summary).passed}</span>
                      <span>失败 {getRunSummaryCounts(run.summary).failed}</span>
                    </div>
                    <div className="douyin-history-actions">
                      <button
                        type="button"
                        onClick={() => restoreHistoryRun(run.id)}
                        disabled={isRestoringRun}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => deleteHistoryRun(run.id)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function DouyinVideoCard({ video, auditResult, isAuditing }) {
  const [expanded, setExpanded] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <article className={`douyin-video-card compact ${expanded ? "expanded" : ""}`}>
      <div className="douyin-video-cover">
        {video.cover_url && !coverFailed ? (
          <img
            src={video.cover_url}
            alt={video.desc ? `${video.desc}封面` : "抖音视频封面"}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span>暂无封面</span>
        )}
        <span className="douyin-video-index">#{video.index}</span>
        <span className="douyin-duration">{formatDuration(video.duration)}</span>
      </div>

      <div className="douyin-video-content">
        <div className="douyin-video-meta">
          <span>
            {video.frontend_name || video.author_name || "未知作者"}
          </span>
          <time>{video.create_time || "发布时间未知"}</time>
        </div>
        {video.profile_matched ? (
          <p className="douyin-card-account-detail">
            {[video.erp_name, video.operator, video.douyin_id]
              .filter(Boolean)
              .join("｜") || "账号资料已匹配"}
          </p>
        ) : (
          <span className="douyin-unmatched-badge">未匹配质检名单</span>
        )}
        <span className="douyin-card-range">
          {video.account_range_label || "未标注筛选范围"}
        </span>
        <h3>{video.desc || "该作品暂无描述"}</h3>
        <AuditResultPanel result={auditResult} isAuditing={isAuditing} />

        <div className="douyin-card-actions">
          <a href={video.page_url} target="_blank" rel="noreferrer">
            打开视频 ↗
          </a>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起视频信息" : "展开视频信息"}
          </button>
        </div>

        {expanded && (
          <div className="douyin-expanded-details">
            <div className="douyin-card-profile-detail">
              <span>账号资料</span>
              <p>前端名称：{video.frontend_name || "未匹配"}</p>
              <p>ERP名称：{video.erp_name || "未填写"}</p>
              <p>运营/编剪：{video.operator || "未填写"}</p>
              <p>抖音号：{video.douyin_id || "未填写"}</p>
              <p>secUid：{shortSecUid(video.secUid)}</p>
            </div>
            <div className="douyin-raw-desc">
              <span>原始 desc</span>
              <p>{video.desc || "无"}</p>
            </div>
            <div className="douyin-video-id">
              <span>视频 ID</span>
              <code>{video.video_id || "-"}</code>
            </div>
            {video.play_url && (
              <details className="douyin-play-url">
                <summary>查看程序播放链接</summary>
                <a href={video.play_url} target="_blank" rel="noreferrer">
                  {video.play_url}
                </a>
              </details>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function AuditResultPanel({ result, isAuditing }) {
  if (!result) {
    return (
      <div className="douyin-ai-placeholder">
        <span>{isAuditing ? "等待本批质检" : "尚未开始 AI 质检"}</span>
      </div>
    );
  }

  const mainRisks = Array.isArray(result.main_risks) ? result.main_risks : [];
  const hitRules = Array.isArray(result.hit_rules) ? result.hit_rules : [];
  const displayStatus = getDisplayAuditStatus(result);
  const tone = displayStatus.tone;
  const conclusion = displayStatus.label;
  const isClearPass =
    displayStatus.key === "passed" &&
    result.need_human_review === false &&
    ["无", "低", "", undefined, null].includes(result.risk_level);
  const primaryProblem =
    isClearPass
      ? "无明显风险，可正常发布。"
      : result.audit_status === "timeout"
        ? "该视频质检超时，建议人工审核。"
        : summarizeText(
            result.problem_description || mainRisks.join("；"),
            80,
            "建议人工审核该视频内容。",
          );
  const suggestion = isClearPass
    ? "无需整改，发布前由运营确认活动价格、国补政策与后台一致即可。"
    : summarizeText(
        result.rectification_suggestion,
        120,
        displayStatus.key === "passed"
          ? "无需整改，发布前由运营确认活动价格、国补政策与后台一致即可。"
          : "建议人工审核该视频并确认风险。",
      );

  return (
    <section className={`douyin-ai-review tone-${tone}`}>
      <header className="douyin-ai-review-header">
        <strong>AI 质检结果</strong>
        <div>
          <span className="audit-mode-tag">
            {getAuditModeLabel(result.audit_mode)}
          </span>
          <span className={`audit-result-tag ${getAuditResultClass(displayStatus.key)}`}>
            {conclusion}
          </span>
          {displayStatus.showRiskLabel && (
            <span className={`risk-level-tag risk-${getRiskClass(result.risk_level)}`}>
              {result.risk_level || "无"}风险
            </span>
          )}
        </div>
      </header>

      <div className="douyin-ai-core-problem">
        <span>{displayStatus.key === "passed" ? "审核结论" : "主要问题"}</span>
        <p>{primaryProblem}</p>
      </div>

      <div className="douyin-ai-evidence-summary">
        <span>证据摘要</span>
        <p>
          <b>文本：</b>
          {summarizeText(result.evidence, 100, "未发现明确文本风险")}
        </p>
        <p>
          <b>画面：</b>
          {summarizeText(
            result.visual_evidence,
            100,
            "未发现明确画面风险",
          )}
        </p>
      </div>

      <div className="douyin-ai-suggestion">
        <span>{displayStatus.key === "human" ? "人工审核建议" : "建议"}</span>
        <p>{suggestion}</p>
      </div>

      <details className="douyin-ai-full-details">
        <summary>展开完整质检详情</summary>
        <div>
          <AuditDetail
            label="原始模型结论"
            value={`${result.audit_result || "无"} / ${result.risk_level || "无"}风险`}
          />
          <AuditList label="命中规则" values={hitRules} emptyText="未命中规则" code />
          <AuditDetail
            label="完整文本证据"
            value={result.evidence || "未发现明确文本风险"}
          />
          <AuditDetail
            label="完整画面证据"
            value={result.visual_evidence || "未发现明确画面风险"}
          />
          <AuditDetail
            label="问题说明"
            value={result.problem_description || "无补充问题说明"}
          />
          <AuditDetail
            label="完整审核建议"
            value={result.rectification_suggestion || "无需整改"}
          />
          {result.visual_error && (
            <div className="douyin-visual-error">
              <span>视觉质检状态</span>
              <p>{result.visual_error}</p>
            </div>
          )}
          {result.error_message && (
            <div className="douyin-visual-error neutral">
              <span>质检错误</span>
              <p>{result.error_message}</p>
            </div>
          )}
          <div className="human-review-status">
            <span>人工复核</span>
            <strong>{result.need_human_review ? "需要" : "不需要"}</strong>
          </div>
          {SHOW_AUDIT_DEBUG && result.debug && (
            <AuditDebugDetails debug={result.debug} />
          )}
        </div>
      </details>
    </section>
  );
}

function AuditDetail({ label, value, className = "" }) {
  if (!value) return null;
  return (
    <div className={`douyin-audit-detail ${className}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function AuditDebugDetails({ debug }) {
  const matchedKeywords = Array.isArray(debug.matched_keywords)
    ? debug.matched_keywords
    : [];
  const matchedRules = Array.isArray(debug.matched_rules)
    ? debug.matched_rules
    : [];

  return (
    <details className="douyin-audit-debug">
      <summary>调试详情</summary>
      <div className="douyin-audit-debug-content">
        <section className="douyin-debug-model-meta">
          <span>model_used：{debug.model_used || "未知"}</span>
          <span>api_type：{debug.api_type || "未知"}</span>
          <span>audit_mode：{debug.audit_mode || "未知"}</span>
          <span>visual_status：{debug.visual_status || "未知"}</span>
          <span>visual_error：{debug.visual_error || "无"}</span>
        </section>
        <DebugBlock title="desc 原文" value={debug.desc || "（空）"} />
        <DebugBlock
          title="matched_keywords"
          value={matchedKeywords.join("、") || "（未命中关键词）"}
        />
        <section className="douyin-debug-block">
          <strong>matched_rules</strong>
          {matchedRules.length > 0 ? (
            <div className="douyin-debug-rules">
              {matchedRules.map((rule, index) => (
                <article key={`${rule.rule_id || "rule"}-${index}`}>
                  <span>{rule.rule_id || "无规则编号"}</span>
                  <p><b>分类：</b>{rule.category || "未分类"}</p>
                  <p><b>判定标准：</b>{rule.standard || "无"}</p>
                  <p><b>整改要求：</b>{rule.rectification || "无"}</p>
                </article>
              ))}
            </div>
          ) : (
            <pre>（未命中规则）</pre>
          )}
        </section>
        <DebugBlock title="传给大模型的 user prompt" value={debug.user_prompt} />
        <DebugBlock
          title="大模型原始返回 raw_response"
          value={formatDebugValue(debug.raw_response)}
        />
      </div>
    </details>
  );
}

function DebugBlock({ title, value }) {
  return (
    <section className="douyin-debug-block">
      <strong>{title}</strong>
      <pre>{value || "（空）"}</pre>
    </section>
  );
}

function AuditList({ label, values, emptyText, code = false }) {
  return (
    <div className="douyin-audit-list">
      <span>{label}</span>
      {values.length > 0 ? (
        <div>
          {values.map((value) =>
            code ? <code key={value}>{value}</code> : <small key={value}>{value}</small>,
          )}
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </div>
  );
}

function OverviewCard({ label, value, tone = "" }) {
  return (
    <article className={`douyin-overview-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ErrorBox({ title, message }) {
  return (
    <div className="error-box douyin-audit-error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

function parseSecUids(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[\s,，]+/u)
        .map(normalizeClientSecUid)
        .filter(Boolean),
    ),
  ];
}

function normalizeClientSecUid(value) {
  return String(value ?? "")
    .replace(/\u200B/gu, "")
    .replace(/\uFEFF/gu, "")
    .trim();
}

function getProfileTaskFields(profile) {
  const matched =
    typeof profile?.profile_matched === "boolean"
      ? profile.profile_matched
      : Boolean(profile?.secUid);
  return {
    frontend_name: profile?.frontend_name || "",
    erp_name: profile?.erp_name || "",
    operator: profile?.operator || "",
    douyin_id: profile?.douyin_id || "",
    profile_matched: matched,
  };
}

function formatImportedTime(value) {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}

function summarizeText(value, limit, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function buildEvidenceSummary(result) {
  if (!result) return "";
  return [
    `文本：${result.evidence || "未发现明确文本风险"}`,
    `画面：${result.visual_evidence || "未发现明确画面风险"}`,
  ].join("；");
}

function getAuditConclusion(result) {
  return getDisplayAuditStatus(result).label;
}

function getAuditTone(result) {
  return getDisplayAuditStatus(result).tone;
}

function sortVideos(videos, sortMode) {
  const items = [...videos];
  const timeSort = (left, right) =>
    Number(right.create_time_ts) - Number(left.create_time_ts);

  if (sortMode === "risk") {
    const rank = {
      human: 0,
      failed: 1,
      passed: 2,
    };
    return items.sort((left, right) => {
      const leftRank = rank[getDisplayAuditStatus(left.auditResult).key] ?? 5;
      const rightRank = rank[getDisplayAuditStatus(right.auditResult).key] ?? 5;
      return leftRank - rightRank || timeSort(left, right);
    });
  }

  if (sortMode === "human") {
    return items.sort(
      (left, right) =>
        Number(Boolean(right.auditResult?.need_human_review)) -
          Number(Boolean(left.auditResult?.need_human_review)) ||
        timeSort(left, right),
    );
  }

  if (sortMode === "account") {
    return items.sort(
      (left, right) =>
        Number(left.account_index) - Number(right.account_index) ||
        timeSort(left, right),
    );
  }

  return items.sort(timeSort);
}

function getAuditSummary(results) {
  return {
    total: results.length,
    passed: results.filter((item) => getDisplayAuditStatus(item).key === "passed").length,
    humanReview: results.filter((item) => getDisplayAuditStatus(item).key === "human").length,
    failed: results.filter((item) => getDisplayAuditStatus(item).key === "failed").length,
  };
}

function buildAuditRunTitle(accountCount, videoCount) {
  return `短视频质检 - 账号数 ${accountCount} - 视频数 ${videoCount} - ${formatRunTime(new Date().toISOString())}`;
}

function buildPersistedRunSummary({
  accounts,
  videos,
  auditResults,
  auditSummary,
  resultRange,
  totalFetched,
}) {
  const enriched = videos.map((video) => ({
    ...video,
    auditResult: auditResults[video.video_id] ?? null,
  }));
  const counts = getFilterCounts(enriched);

  return {
    account_count: accounts.length,
    success_account_count: accounts.filter((account) => account.status === "success").length,
    failed_account_count: accounts.filter((account) => account.status === "failed").length,
    video_count: videos.length,
    total: videos.length,
    passed: counts.passed,
    humanReview: counts.human,
    failed: counts.failed,
    totalFetched: Number(totalFetched) || 0,
    resultRange,
    auditSummary,
    filter_counts: counts,
  };
}

function normalizeRestoredRange(value) {
  const fallback = getClientRange("last7");
  const rangeType = ["last3", "last7", "last30", "custom"].includes(
    value?.rangeType,
  )
    ? value.rangeType
    : fallback.rangeType;
  const range =
    rangeType === "custom"
      ? {
          rangeType,
          startDate: value?.startDate || fallback.startDate,
          endDate: value?.endDate || fallback.endDate,
        }
      : getClientRange(rangeType);

  return {
    ...range,
    startDate: value?.startDate || range.startDate,
    endDate: value?.endDate || range.endDate,
  };
}

function normalizeRestoredTasks(value) {
  return Array.isArray(value)
    ? value
        .filter((task) => task?.secUid)
        .map((task) => ({
          ...task,
          rangeType: task.rangeType || "default",
          startDate: task.startDate || "",
          endDate: task.endDate || "",
          status: task.status || "pending",
          message: task.message || "",
        }))
    : [];
}

function normalizeAuditResultsMap(value) {
  if (value && !Array.isArray(value) && typeof value === "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((result) => result?.video_id)
        .map((result) => [result.video_id, result]),
    );
  }

  return {};
}

function getRunSummaryCounts(summary = {}) {
  const filters = summary.filter_counts ?? {};
  const passed = Number(summary.passed ?? filters.passed) || 0;
  const failed = Number(summary.failed ?? filters.failed) || 0;
  const legacyFix =
    Number(summary.need_fix ?? summary.rectification ?? filters.fix) || 0;
  const legacyHigh =
    Number(summary.high_risk ?? summary.highRisk ?? filters.high) || 0;
  const humanReview =
    Number(summary.humanReview ?? summary.need_human_review ?? filters.human) ||
    0;
  const total =
    Number(summary.total ?? summary.video_count ?? filters.all) ||
    passed + failed + humanReview + legacyFix + legacyHigh;

  return {
    total,
    passed,
    failed,
    humanReview: humanReview + legacyFix + legacyHigh,
  };
}

function getAuditRunApiError(response, payload, fallback) {
  if (response?.status === 401) {
    return "登录状态已失效，请重新登录。";
  }

  if (response?.status === 403) {
    return "无权限查看或修改该历史记录。";
  }

  if (
    response?.status === 404 ||
    payload?.code === "NOT_FOUND" ||
    payload?.message === "请求的接口不存在。"
  ) {
    return "历史记录接口不可用，请检查后端是否已部署最新版本。";
  }

  return payload?.message || fallback;
}

function getRunStatusLabel(value) {
  return {
    pending: "待处理",
    fetched: "已获取作品",
    auditing: "质检中",
    completed: "已完成",
    failed: "失败",
  }[value] ?? "待处理";
}

function formatRunTime(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function getAuditResultClass(value) {
  return {
    passed: "passed",
    fix: "rectify",
    high: "rejected",
    human: "review",
    failed: "pending",
    通过: "passed",
    需整改: "rectify",
    高风险退回: "rejected",
    建议人工复核: "review",
  }[value] ?? "review";
}

function getRiskClass(value) {
  return { 无: "none", 低: "low", 中: "medium", 高: "high" }[value] ?? "none";
}

function getAuditModeLabel(value) {
  return {
    video: "视频视觉质检",
    text_fallback: "文本降级",
    text: "仅文本",
    failed: "质检失败",
  }[value] ?? "仅文本";
}

function getTaskDisplayRange(task, defaultRange) {
  if (task.rangeType === "default") {
    return `跟随默认 · ${getRangeLabel(defaultRange.rangeType)}`;
  }
  return getRangeLabel(task.rangeType);
}

function getTaskStatusLabel(value) {
  return {
    pending: "待获取",
    loading: "获取中",
    success: "已完成",
    failed: "失败",
  }[value] ?? "待获取";
}

function shortSecUid(value) {
  const text = String(value ?? "");
  return text.length > 20
    ? `${text.slice(0, 10)}...${text.slice(-6)}`
    : text;
}

function getClientRange(rangeType) {
  const option = rangeOptions.find((item) => item.value === rangeType);
  const endDate = formatLocalDate(new Date());
  const start = new Date(`${endDate}T00:00:00`);
  start.setDate(start.getDate() - (option?.days ?? 7));
  return { rangeType, startDate: formatLocalDate(start), endDate };
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeLabel(value) {
  return rangeOptions.find((option) => option.value === value)?.label ?? "时间范围";
}

function formatDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "时长未知";
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : `${seconds} 秒`;
}

function joinValues(value) {
  return Array.isArray(value) ? value.join("；") : String(value ?? "");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function formatDebugValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}
