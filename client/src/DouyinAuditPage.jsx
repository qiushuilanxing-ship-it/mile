import { useEffect, useMemo, useState } from "react";
import {
  getDisplayAuditStatus,
  getFilterCounts,
  getFinalDecision,
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
  { value: "notAudited", label: "待AI质检" },
  { value: "passed", label: "可发布" },
  { value: "human", label: "人工审核" },
  { value: "rejected", label: "退回修改" },
  { value: "failed", label: "质检失败" },
];
const manualFilterOptions = [
  { value: "all", label: "全部人工审核" },
  { value: "pending", label: "待审核" },
  { value: "rejected", label: "退回修改" },
  { value: "ignored", label: "已忽略" },
];
const feedbackFilterOptions = [
  { value: "all", label: "全部" },
  { value: "false_positive", label: "AI 误判" },
  { value: "false_negative", label: "AI 漏判" },
  { value: "rule_gap", label: "规则补充" },
  { value: "none", label: "未反馈" },
];
const feedbackTypeOptions = feedbackFilterOptions.filter(
  (option) => !["all", "none"].includes(option.value),
);
const sampleFeedbackFilterOptions = feedbackFilterOptions.filter(
  (option) => option.value !== "none",
);
const ruleCategoryOptions = [
  "价格活动",
  "商品信息",
  "站外导流",
  "极限词/夸大宣传",
  "直播间福利",
  "素材版权",
  "AI生成内容",
  "低俗/敏感内容",
  "其他",
];
const emptyRuleForm = {
  title: "",
  category: "价格活动",
  risk_level: "中",
  decision: "建议人工审核",
  keywords: "",
  description: "",
  positive_examples: "",
  negative_examples: "",
  suggested_action: "",
  enabled: true,
  source_sample_id: "",
};
const SHOW_AUDIT_DEBUG = import.meta.env.DEV;
const AI_AUDIT_BATCH_SIZE = Number(import.meta.env.VITE_AI_AUDIT_BATCH_SIZE) || 3;
const AUDIT_STATUS_LABELS = {
  not_started: "待AI质检",
  pending: "等待质检",
  auditing: "质检中",
  completed: "质检完成",
  failed: "质检失败",
  timeout: "质检超时",
};

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
  const [manualReviews, setManualReviews] = useState({});
  const [feedbacks, setFeedbacks] = useState({});
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditProgress, setAuditProgress] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [manualFilter, setManualFilter] = useState("all");
  const [feedbackFilter, setFeedbackFilter] = useState("all");
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
  const [isFeedbackSamplesOpen, setIsFeedbackSamplesOpen] = useState(false);
  const [feedbackSamples, setFeedbackSamples] = useState([]);
  const [feedbackSampleSummary, setFeedbackSampleSummary] = useState(null);
  const [feedbackSampleScope, setFeedbackSampleScope] = useState("mine");
  const [feedbackSampleType, setFeedbackSampleType] = useState("all");
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [auditRules, setAuditRules] = useState([]);
  const [ruleCategoryFilter, setRuleCategoryFilter] = useState("all");
  const [ruleEnabledFilter, setRuleEnabledFilter] = useState("1");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleForm, setRuleForm] = useState(emptyRuleForm);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [selectedRule, setSelectedRule] = useState(null);
  const [isRuleFormOpen, setIsRuleFormOpen] = useState(false);
  const [isRulesLoading, setIsRulesLoading] = useState(false);
  const [ruleError, setRuleError] = useState("");
  const [ruleMessage, setRuleMessage] = useState("");
  const [isRestoringRun, setIsRestoringRun] = useState(false);
  const [isRunSaving, setIsRunSaving] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [runError, setRunError] = useState("");
  const [historyScope, setHistoryScope] = useState("mine");
  const [isQueryExpanded, setIsQueryExpanded] = useState(() =>
    readBooleanPreference("douyin.queryExpanded", true),
  );
  const [isAccountDrawerOpen, setIsAccountDrawerOpen] = useState(false);
  const [isTaskDetailsOpen, setIsTaskDetailsOpen] = useState(() =>
    readBooleanPreference("douyin.taskDetailsExpanded", false),
  );
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(() =>
    readBooleanPreference("douyin.moreFiltersExpanded", false),
  );
  const [detailVideoId, setDetailVideoId] = useState("");
  const [detailTab, setDetailTab] = useState("result");
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

  useEffect(() => {
    setManualReviews((current) => initializeManualReviews(auditResults, current));
  }, [auditResults]);

  const enrichedVideos = useMemo(
    () =>
      videos.map((video) => {
        const auditResult = auditResults[video.video_id] ?? null;
        const manualReview = manualReviews[video.video_id] ?? null;
        return {
          ...video,
          auditResult,
          manualReview,
          feedback: feedbacks[video.video_id] ?? null,
          finalDecision: getFinalDecision(video, auditResult, manualReview),
        };
      }),
    [videos, auditResults, manualReviews, feedbacks],
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
      matchesFilter(video, activeFilter),
    );
    const manuallyFiltered =
      activeFilter === "human" && manualFilter !== "all"
        ? filtered.filter(
            (video) => getManualDecisionStatus(video.finalDecision) === manualFilter,
          )
        : filtered;
    const feedbackFiltered =
      feedbackFilter !== "all"
        ? manuallyFiltered.filter((video) =>
            matchesFeedbackFilter(video.feedback, feedbackFilter),
          )
        : manuallyFiltered;
    return sortVideos(feedbackFiltered, sortMode);
  }, [accountFilteredVideos, activeFilter, manualFilter, feedbackFilter, sortMode]);
  const detailVideo = useMemo(
    () => enrichedVideos.find((video) => video.video_id === detailVideoId) || null,
    [enrichedVideos, detailVideoId],
  );

  useEffect(() => {
    writeBooleanPreference("douyin.queryExpanded", isQueryExpanded);
  }, [isQueryExpanded]);

  useEffect(() => {
    writeBooleanPreference("douyin.taskDetailsExpanded", isTaskDetailsOpen);
  }, [isTaskDetailsOpen]);

  useEffect(() => {
    writeBooleanPreference("douyin.moreFiltersExpanded", isMoreFiltersOpen);
  }, [isMoreFiltersOpen]);

  useEffect(() => {
    if (videos.length > 0) {
      setIsQueryExpanded(false);
    }
  }, [videos.length]);

  useEffect(() => {
    if (!runMessage) return undefined;
    const timer = window.setTimeout(() => setRunMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [runMessage]);

  useEffect(() => {
    if (!copyMessage) return undefined;
    const timer = window.setTimeout(() => setCopyMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [copyMessage]);

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
    setAuditResults({});
    setManualReviews({});
    setFeedbacks({});
    setAuditSummary(null);
    setAuditProgress(null);
    setIsAuditing(false);
    setSelectedAccount("all");
  }

  function retryProblemAccounts() {
    if (retryableFetchAccounts.length === 0) return;

    const nextTasks = retryableFetchAccounts.map((account) => {
      const rangeType = account.range_type || "default";
      const isCustom = rangeType === "custom";
      return {
        secUid: account.secUid,
        ...getProfileTaskFields(account),
        rangeType,
        startDate: isCustom ? account.debug?.startDate || "" : "",
        endDate: isCustom ? account.debug?.endDate || "" : "",
        useCustomRange: isCustom,
        status: "pending",
        message: "",
      };
    });

    setSecUidInput(nextTasks.map((task) => task.secUid).join("\n"));
    setAccountTasks(nextTasks);
    setIsQueryExpanded(true);
    setRunMessage("已筛选失败/部分获取账号，请确认日期范围后重新获取。");
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

  async function loadFeedbackSamples(
    scope = feedbackSampleScope,
    type = feedbackSampleType,
  ) {
    const safeScope = canViewAllAuditRuns && scope === "all" ? "all" : "mine";
    const safeType = sampleFeedbackFilterOptions.some((option) => option.value === type)
      ? type
      : "all";

    setRunError("");
    try {
      const response = await fetch(
        `/api/audit/feedback-samples?scope=${safeScope}&type=${safeType}&limit=200`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getFeedbackSampleApiError(response, payload));
      }
      setFeedbackSamples(Array.isArray(payload?.samples) ? payload.samples : []);
      setFeedbackSampleSummary(payload?.summary || null);
      setRunError("");
    } catch (requestError) {
      setRunError(requestError.message || "质检样本库读取失败。");
    }
  }

  async function loadAuditRules(overrides = {}) {
    const enabled = overrides.enabled ?? ruleEnabledFilter;
    const category = overrides.category ?? ruleCategoryFilter;
    const keyword = overrides.keyword ?? ruleKeyword;
    const params = new URLSearchParams({
      enabled,
      limit: "200",
    });

    if (category !== "all") params.set("category", category);
    if (keyword.trim()) params.set("keyword", keyword.trim());

    setIsRulesLoading(true);
    setRuleError("");
    try {
      const response = await fetch(`/api/audit/rules?${params.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getRuleApiError(response, payload));
      }
      setAuditRules(Array.isArray(payload?.rules) ? payload.rules : []);
    } catch (requestError) {
      setRuleError(requestError.message || "规则库加载失败，请稍后重试。");
    } finally {
      setIsRulesLoading(false);
    }
  }

  function openRuleCreate(draft = {}) {
    setEditingRuleId(null);
    setSelectedRule(null);
    setRuleForm({
      ...emptyRuleForm,
      ...ruleToForm(draft),
    });
    setIsRuleFormOpen(true);
    setIsRulesOpen(true);
  }

  function openRuleEdit(rule) {
    setEditingRuleId(rule.id);
    setSelectedRule(rule);
    setRuleForm(ruleToForm(rule));
    setIsRuleFormOpen(true);
  }

  async function saveRuleForm(event) {
    event?.preventDefault();
    const payload = formToRulePayload(ruleForm);

    setRuleError("");
    setRuleMessage("");
    try {
      const response = await fetch(
        editingRuleId ? `/api/audit/rules/${editingRuleId}` : "/api/audit/rules",
        {
          method: editingRuleId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success === false) {
        throw new Error(getRuleApiError(response, result));
      }
      setRuleMessage(editingRuleId ? "规则已更新。" : "规则已新增。");
      setIsRuleFormOpen(false);
      setEditingRuleId(null);
      setRuleForm(emptyRuleForm);
      loadAuditRules();
    } catch (requestError) {
      setRuleError(requestError.message || "规则保存失败，请稍后重试。");
    }
  }

  async function toggleRule(rule) {
    setRuleError("");
    try {
      const response = await fetch(`/api/audit/rules/${rule.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getRuleApiError(response, payload));
      }
      setRuleMessage(rule.enabled ? "规则已停用。" : "规则已启用。");
      loadAuditRules();
    } catch (requestError) {
      setRuleError(requestError.message || "规则状态更新失败。");
    }
  }

  async function deleteRule(rule) {
    if (!window.confirm(`确认删除规则「${rule.title}」吗？`)) return;

    setRuleError("");
    try {
      const response = await fetch(`/api/audit/rules/${rule.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getRuleApiError(response, payload));
      }
      setRuleMessage("规则已删除。");
      if (selectedRule?.id === rule.id) setSelectedRule(null);
      loadAuditRules();
    } catch (requestError) {
      setRuleError(requestError.message || "规则删除失败。");
    }
  }

  async function convertSampleToRule(sample) {
    setRuleError("");
    try {
      const response = await fetch("/api/audit/rules/from-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: sample.run_id,
          video_id: sample.video_id,
          sample,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(getRuleApiError(response, payload));
      }
      openRuleCreate(payload.draft || {});
    } catch (requestError) {
      setRunError(requestError.message || "样本转规则失败。");
    }
  }

  function restoreAuditRun(run, { auto = false } = {}) {
    const defaultRange = normalizeRestoredRange(run.defaultRange);
    const restoredTasks = normalizeRestoredTasks(run.accountTasks);
    const restoredAccounts = Array.isArray(run.accounts) ? run.accounts : [];
    const restoredVideos = Array.isArray(run.videos) ? run.videos : [];
    const restoredResults = normalizeAuditResultsMap(run.auditResults);
    const restoredManualReviews = normalizeManualReviewsMap(
      run.manualReviews,
      restoredResults,
    );
    const restoredFeedbacks = normalizeFeedbacksMap(run.feedbacks);
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
    setManualReviews(restoredManualReviews);
    setFeedbacks(restoredFeedbacks);
    setAuditSummary(restoredSummary);
    setResultRange(run.summary?.resultRange ?? defaultRange);
    setTotalFetched(Number(run.summary?.totalFetched) || restoredVideos.length);
    setResponseMessage("");
    setError("");
    setAuditError("");
    setActiveFilter("all");
    setManualFilter("all");
    setFeedbackFilter("all");
    setSelectedAccount("all");
    setUnmatchedOnly(false);
    setHasSearched(restoredVideos.length > 0 || restoredAccounts.length > 0);
    setIsAuditing(false);
    setAuditProgress(null);
    setIsQueryExpanded(false);
    setIsAccountDrawerOpen(false);
    setDetailVideoId("");
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
    const nextManualReviews = overrides.manualReviews ?? manualReviews;
    const nextFeedbacks = overrides.feedbacks ?? feedbacks;
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
          manualReviews: nextManualReviews,
          feedbacks: nextFeedbacks,
          summary: buildPersistedRunSummary({
            accounts: nextAccounts,
            videos: nextVideos,
            auditResults: nextAuditResults,
            manualReviews: nextManualReviews,
            feedbacks: nextFeedbacks,
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
    setManualReviews({});
    setFeedbacks({});
    setAuditSummary(null);
    setAuditProgress(null);
    setIsAuditing(false);
    setActiveFilter("all");
    setManualFilter("all");
    setFeedbackFilter("all");
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
    setSelectedProfileUids(new Set());
    setIsAccountDrawerOpen(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (videos.length > 0) {
      const confirmed = window.confirm(
        "???? " + videos.length + " ???????????????????????",
      );

      if (!confirmed) return;
    }

    await fetchAccountWorks({
      mode: "replace",
      tasks: accountTasks,
      append: false,
    });
  }

  async function handleRetryPendingAccounts() {
    const retryTasks = accountTasks.filter((task) =>
      ["pending_retry", "partial_success"].includes(task.status),
    );

    if (retryTasks.length === 0) {
      setRunError("??????????");
      return;
    }

    await fetchAccountWorks({
      mode: "retry_pending",
      tasks: retryTasks,
      append: true,
    });
  }

  async function fetchAccountWorks({ mode, tasks, append }) {
    const targetTasks = Array.isArray(tasks) ? tasks : [];

    if (targetTasks.length === 0) {
      setError("???????????????");
      return;
    }

    if (targetTasks.length > 10) {
      setError("?????? 10 ??????");
      return;
    }

    const invalidCustomTask = targetTasks.find(
      (task) =>
        task.rangeType === "custom" &&
        (!normalizeDateForApi(task.startDate) ||
          !normalizeDateForApi(task.endDate) ||
          normalizeDateForApi(task.startDate) >
            normalizeDateForApi(task.endDate)),
    );

    if (invalidCustomTask) {
      setError(
        "?? " +
          shortSecUid(invalidCustomTask.secUid) +
          " ????????????????",
      );
      return;
    }

    const normalizedStartDate = normalizeDateForApi(startDate);
    const normalizedEndDate = normalizeDateForApi(endDate);

    if (
      !normalizedStartDate ||
      !normalizedEndDate ||
      normalizedStartDate > normalizedEndDate
    ) {
      setError("????????????????");
      return;
    }

    const requestedRange =
      rangeType === "custom"
        ? {
            rangeType,
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          }
        : getClientRange(rangeType);

    setIsLoading(true);
    setIsAuditing(false);
    setError("");
    setAuditError("");
    setResponseMessage("");
    setHasSearched(true);

    if (!append) {
      setVideos([]);
      setAccounts([]);
      setAuditResults({});
      setManualReviews({});
      setFeedbacks({});
      setAuditSummary(null);
      setAuditProgress(null);
      setTotalFetched(0);
      setActiveFilter("all");
      setSelectedAccount("all");
      setUnmatchedOnly(false);
    }

    const loadingSecUids = new Set(targetTasks.map((task) => task.secUid));
    setAccountTasks((currentTasks) =>
      currentTasks.map((task) =>
        loadingSecUids.has(task.secUid)
          ? { ...task, status: "loading", message: "" }
          : task,
      ),
    );

    try {
      const response = await fetch("/api/audit/douyin-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          defaultRange: requestedRange,
          accountTasks: targetTasks.map(formatAccountTaskForRequest),
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "???????????????");
      }

      const incomingVideos = Array.isArray(payload?.videos)
        ? payload.videos.map((video) => ({
            ...video,
            ai_audit_status: video.ai_audit_status || "not_started",
            ai_audit_error: video.ai_audit_error || "",
            ai_audit_last_at: video.ai_audit_last_at || "",
          }))
        : [];
      const incomingAccounts = Array.isArray(payload?.accounts)
        ? payload.accounts
        : [];
      const nextVideos = append
        ? mergeVideosByIdentity(videos, incomingVideos)
        : incomingVideos;
      const nextAccounts = append
        ? mergeAccountsBySecUid(accounts, incomingAccounts)
        : incomingAccounts;
      const nextResultRange = payload?.defaultRange ?? requestedRange;
      const nextTotalFetched = append
        ? totalFetched + (Number(payload?.totalFetched) || 0)
        : Number(payload?.totalFetched) || 0;
      const accountsBySecUid = new Map(
        incomingAccounts.map((account) => [normalizeClientSecUid(account.secUid), account]),
      );
      const nextAccountTasks = accountTasks.map((task) => {
        const account = accountsBySecUid.get(normalizeClientSecUid(task.secUid));
        if (!account) return task;
        return {
          ...task,
          ...(account ? getProfileTaskFields(account) : {}),
          status: account.status ?? "failed",
          message:
            account.message ||
            (account
              ? ""
              : "?????????????? secUid ????????"),
        };
      });
      const nextAuditResults = append ? auditResults : {};
      const nextManualReviews = append ? manualReviews : {};
      const nextFeedbacks = append ? feedbacks : {};
      const nextAuditSummary = append ? auditSummary : null;

      setVideos(nextVideos);
      setAccounts(nextAccounts);
      setResultRange(nextResultRange);
      setTotalFetched(nextTotalFetched);
      setResponseMessage(payload?.message || "");
      setAccountTasks(nextAccountTasks);
      setAuditResults(nextAuditResults);
      setManualReviews(nextManualReviews);
      setFeedbacks(nextFeedbacks);
      setAuditSummary(nextAuditSummary);

      await saveAuditRun("fetched", {
        defaultRange: nextResultRange,
        accountTasks: nextAccountTasks,
        accounts: nextAccounts,
        videos: nextVideos,
        auditResults: nextAuditResults,
        manualReviews: nextManualReviews,
        feedbacks: nextFeedbacks,
        auditSummary: nextAuditSummary,
        resultRange: nextResultRange,
        totalFetched: nextTotalFetched,
        message: append
          ? "?????????????"
          : "????????????????",
      });
    } catch (requestError) {
      setError(requestError.message || "???????????????");
      setAccountTasks((currentTasks) =>
        currentTasks.map((task) =>
          loadingSecUids.has(task.secUid)
            ? {
                ...task,
                status: "failed",
                message: requestError.message || "????",
              }
            : task,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAiAuditLegacy() {
    if (visibleVideos.length === 0 || isAuditing) return;

    const auditVideos = visibleVideos.map(
      ({ auditResult: _auditResult, ...video }) => video,
    );
    const totalBatches = Math.ceil(auditVideos.length / AI_AUDIT_BATCH_SIZE);
    setIsAuditing(true);
    setAuditError("");
    setAuditResults({});
    setManualReviews({});
    setAuditSummary(null);
    setAuditProgress({
      completed: 0,
      total: auditVideos.length,
      currentBatch: 1,
      totalBatches,
    });

    await saveAuditRun("auditing", {
      auditResults: {},
      manualReviews: {},
      auditSummary: null,
      message: "AI 质检已开始，当前记录已更新。",
      note: "AI 质检中",
    });

    const allResults = [];
    let localMatchedCount = 0;
    let visionCount = 0;
    let textFallbackCount = 0;

    try {
      for (let index = 0; index < auditVideos.length; index += AI_AUDIT_BATCH_SIZE) {
        const currentBatch = Math.floor(index / AI_AUDIT_BATCH_SIZE) + 1;
        const batch = auditVideos.slice(index, index + AI_AUDIT_BATCH_SIZE);
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
      const nextManualReviews = initializeManualReviews(
        nextAuditResults,
        manualReviews,
      );
      setAuditSummary(nextAuditSummary);
      setManualReviews(nextManualReviews);
      setAuditProgress({
        completed: allResults.length,
        total: auditVideos.length,
        currentBatch: totalBatches,
        totalBatches,
      });
      await saveAuditRun("completed", {
        auditResults: nextAuditResults,
        manualReviews: nextManualReviews,
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
        manualReviews,
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

  async function handleAiAudit() {
    if (!canStartAiAudit) {
      setRunError("请先获取账号作品后再开始 AI 质检。");
      return null;
    }

    return runAiAuditForVideos(enrichedVideos, {
      mode: "all",
      startMessage: "AI 质检已开始，当前记录已更新。",
      finishMessage: "AI 质检结果已保存。",
    });
  }

  async function retryOneVideo(video) {
    return runAiAuditForVideos([video], {
      mode: "retry",
      startMessage: "正在重新质检该视频。",
      finishMessage: "该视频重试结果已保存。",
    });
  }

  async function retryFailedVideos() {
    const failedVideos = accountFilteredVideos.filter(isVideoAuditFailed);
    if (failedVideos.length === 0) return null;

    return runAiAuditForVideos(failedVideos, {
      mode: "retry",
      startMessage: "正在重试失败视频。",
      finishMessage: "失败视频重试结果已保存。",
    });
  }

  async function runAiAuditForVideos(targetVideos, options = {}) {
    if (!Array.isArray(videos) || videos.length === 0) {
      setRunError("请先获取账号作品后再开始 AI 质检。");
      return null;
    }

    if (!Array.isArray(targetVideos) || targetVideos.length === 0) {
      setRunError("当前没有可质检的视频，请先获取账号作品。");
      return null;
    }

    if (isAuditing) {
      return null;
    }

    const mode = options.mode || "all";
    const auditVideos = targetVideos
      .map(stripClientOnlyVideoFields)
      .filter((video) => video?.video_id);
    if (auditVideos.length === 0) return null;

    const targetIds = new Set(auditVideos.map((video) => video.video_id));
    const totalBatches = Math.ceil(auditVideos.length / AI_AUDIT_BATCH_SIZE);
    let workingVideos = markVideosForAudit(videos, targetIds, {
      status: "pending",
      error: "",
      retried: mode === "retry",
    });
    let workingAuditResults =
      mode === "all"
        ? removeAuditResultsForIds(auditResults, targetIds)
        : { ...auditResults };
    let workingManualReviews = { ...manualReviews };
    let localMatchedCount = 0;
    let visionCount = 0;
    let textFallbackCount = 0;
    let completedCount = 0;

    setIsAuditing(true);
    setAuditError("");
    setVideos(workingVideos);
    setAuditResults(workingAuditResults);
    setAuditSummary(null);
    setAuditProgress({
      status: "running",
      completed: 0,
      total: auditVideos.length,
      currentBatch: 1,
      totalBatches,
      currentVideo: auditVideos[0]?.desc || auditVideos[0]?.video_id || "",
      ...getProgressCounts(workingAuditResults),
    });

    await saveAuditRun("auditing", {
      videos: workingVideos,
      auditResults: workingAuditResults,
      manualReviews: workingManualReviews,
      auditSummary: null,
      message: options.startMessage || "AI 质检已开始。",
      note: "AI 质检中",
    });

    try {
      for (let index = 0; index < auditVideos.length; index += AI_AUDIT_BATCH_SIZE) {
        const currentBatch = Math.floor(index / AI_AUDIT_BATCH_SIZE) + 1;
        const batch = auditVideos.slice(index, index + AI_AUDIT_BATCH_SIZE);
        const batchIds = new Set(batch.map((video) => video.video_id));
        workingVideos = markVideosForAudit(workingVideos, batchIds, {
          status: "auditing",
          error: "",
          retried: mode === "retry",
        });

        setVideos(workingVideos);
        setAuditProgress({
          status: "running",
          completed: completedCount,
          total: auditVideos.length,
          currentBatch,
          totalBatches,
          currentVideo: batch[0]?.desc || batch[0]?.video_id || "",
          ...getProgressCounts(workingAuditResults),
        });

        const batchPayload = await requestAuditBatch(batch);
        const batchResults = normalizeBatchResults(batch, batchPayload);
        completedCount += batch.length;
        localMatchedCount += Number(batchPayload?.local_matched_count) || 0;
        visionCount += Number(batchPayload?.vision_count) || 0;
        textFallbackCount += Number(batchPayload?.text_fallback_count) || 0;

        workingAuditResults = {
          ...workingAuditResults,
          ...Object.fromEntries(
            batchResults
              .filter((result) => result?.video_id)
              .map((result) => [result.video_id, result]),
          ),
        };
        workingVideos = applyAuditResultsToVideos(
          workingVideos,
          batch,
          batchResults,
          mode === "retry",
        );
        workingManualReviews = initializeManualReviews(
          workingAuditResults,
          workingManualReviews,
        );

        setAuditResults(workingAuditResults);
        setVideos(workingVideos);
        setManualReviews(workingManualReviews);
        setAuditProgress({
          status: completedCount >= auditVideos.length ? "completed" : "running",
          completed: completedCount,
          total: auditVideos.length,
          currentBatch,
          totalBatches,
          currentVideo: batch[batch.length - 1]?.desc || batch[batch.length - 1]?.video_id || "",
          ...getProgressCounts(workingAuditResults),
        });
      }

      const nextAuditSummary = {
        ...getAuditSummary(Object.values(workingAuditResults)),
        localMatchedCount,
        visionCount,
        textFallbackCount,
      };
      setAuditSummary(nextAuditSummary);
      setAuditProgress((current) => ({
        ...(current || {}),
        status: "completed",
        completed: auditVideos.length,
        total: auditVideos.length,
        currentBatch: totalBatches,
        totalBatches,
        currentVideo: "质检完成",
        ...getProgressCounts(workingAuditResults),
      }));
      await saveAuditRun("completed", {
        videos: workingVideos,
        auditResults: workingAuditResults,
        manualReviews: workingManualReviews,
        auditSummary: nextAuditSummary,
        message: options.finishMessage || "AI 质检结果已保存。",
      });
      return workingAuditResults;
    } catch (requestError) {
      const message = requestError.message || "AI 质检失败，请稍后重试。";
      const fallbackResults = auditVideos.map((video) =>
        buildClientAuditFailure(video, message),
      );
      workingAuditResults = {
        ...workingAuditResults,
        ...Object.fromEntries(
          fallbackResults.map((result) => [result.video_id, result]),
        ),
      };
      workingVideos = applyAuditResultsToVideos(
        workingVideos,
        auditVideos,
        fallbackResults,
        mode === "retry",
      );
      const nextAuditSummary = getAuditSummary(Object.values(workingAuditResults));

      setAuditError(message);
      setAuditResults(workingAuditResults);
      setVideos(workingVideos);
      setAuditSummary(nextAuditSummary);
      setAuditProgress((current) => ({
        ...(current || {}),
        status: "completed",
        completed: auditVideos.length,
        total: auditVideos.length,
        currentVideo: "质检完成",
        ...getProgressCounts(workingAuditResults),
      }));
      await saveAuditRun("completed", {
        videos: workingVideos,
        auditResults: workingAuditResults,
        manualReviews: workingManualReviews,
        auditSummary: nextAuditSummary,
        note: message,
        message: "AI 质检失败，已保存当前失败状态。",
      });
      return workingAuditResults;
    } finally {
      setIsAuditing(false);
    }
  }

  async function requestAuditBatch(batch) {
    try {
      const response = await fetch("/api/audit/douyin-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: batch }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.success === false) {
        const message =
          payload?.details?.detail ||
          payload?.message ||
          "AI 质检失败，请稍后重试。";
        return {
          success: false,
          results: batch.map((video) => buildClientAuditFailure(video, message)),
        };
      }

      return payload || { success: true, results: [] };
    } catch (requestError) {
      const message = requestError.message || "AI 模型接口异常，请稍后重试。";
      return {
        success: false,
        results: batch.map((video) => buildClientAuditFailure(video, message)),
      };
    }
  }

  async function markFailedVideoAsHuman(video) {
    if (!video?.video_id) return;

    const humanResult = buildManualFallbackAuditResult(video);
    const nextAuditResults = {
      ...auditResults,
      [video.video_id]: humanResult,
    };
    const nextManualReviews = initializeManualReviews(nextAuditResults, {
      ...manualReviews,
      [video.video_id]: manualReviews[video.video_id] || createPendingManualReview(),
    });
    const nextVideos = videos.map((item) =>
      item.video_id === video.video_id
        ? {
            ...item,
            ai_audit_status: "completed",
            ai_audit_error: "",
            ai_audit_last_at: new Date().toISOString(),
          }
        : item,
    );
    const nextAuditSummary = getAuditSummary(Object.values(nextAuditResults));

    setAuditResults(nextAuditResults);
    setManualReviews(nextManualReviews);
    setVideos(nextVideos);
    setAuditSummary(nextAuditSummary);
    await saveAuditRun("completed", {
      videos: nextVideos,
      auditResults: nextAuditResults,
      manualReviews: nextManualReviews,
      auditSummary: nextAuditSummary,
      message: "已标记为人工审核并保存。",
    });
  }

  async function handleManualReviewChange(video, patch, feedbackMessage = "人工处理结果已保存。") {
    if (!video?.video_id) return;

    const previousReview =
      manualReviews[video.video_id] ||
      createPendingManualReview();
    const shouldStampReviewer =
      patch.touch || (patch.status && patch.status !== "pending");
    const nextReview = {
      ...previousReview,
      ...patch,
      reviewed_by:
        shouldStampReviewer
          ? String(user?.id ?? user?.username ?? "")
          : patch.reviewed_by ?? previousReview.reviewed_by ?? "",
      reviewed_by_name:
        shouldStampReviewer
          ? user?.name || user?.username || ""
          : patch.reviewed_by_name ?? previousReview.reviewed_by_name ?? "",
      reviewed_at:
        shouldStampReviewer
          ? new Date().toISOString()
          : patch.reviewed_at ?? previousReview.reviewed_at ?? "",
    };
    delete nextReview.touch;
    const nextManualReviews = {
      ...manualReviews,
      [video.video_id]: normalizeManualReview(nextReview),
    };

    setManualReviews(nextManualReviews);
    const savedRun = await saveAuditRun(
      Object.keys(auditResults).length > 0 ? "completed" : "fetched",
      {
        manualReviews: nextManualReviews,
        message: feedbackMessage,
      },
    );

    if (!savedRun) {
      setRunError("人工处理结果保存失败，请稍后重试。");
    }
  }

  async function handleAiFeedbackChange(video, patch, feedbackMessage = "纠错反馈已保存。") {
    if (!video?.video_id) return;

    if (patch?._delete) {
      const nextFeedbacks = { ...feedbacks };
      delete nextFeedbacks[video.video_id];
      setFeedbacks(nextFeedbacks);
      const savedRun = await saveAuditRun(
        Object.keys(auditResults).length > 0 ? "completed" : "fetched",
        {
          feedbacks: nextFeedbacks,
          message: feedbackMessage,
        },
      );

      if (!savedRun) {
        setRunError("纠错反馈删除失败，请稍后重试。");
      }
      return;
    }

    const previousFeedback =
      feedbacks[video.video_id] ||
      createEmptyFeedback();
    const nextFeedback = normalizeFeedback({
      ...previousFeedback,
      ...patch,
      feedback_by: String(user?.id ?? user?.username ?? ""),
      feedback_by_name: user?.name || user?.username || "",
      feedback_at: new Date().toISOString(),
    });
    const nextFeedbacks = {
      ...feedbacks,
      [video.video_id]: nextFeedback,
    };

    setFeedbacks(nextFeedbacks);
    const savedRun = await saveAuditRun(
      Object.keys(auditResults).length > 0 ? "completed" : "fetched",
      {
        feedbacks: nextFeedbacks,
        message: feedbackMessage,
      },
    );

    if (!savedRun) {
      setRunError("纠错反馈保存失败，请稍后重试。");
    }
  }

  function exportCurrentResults() {
    if (visibleVideos.length === 0) return;

    const rows = [
      [
        "最终结论",
        "最终结论来源",
        "最终结论原因",
        "前端名称",
        "ERP名称",
        "运营/编剪",
        "抖音号",
        "secUid",
        "发布时间",
        "视频链接",
        "审核结论",
        "是否人工审核",
        "AI审核结论",
        "人工处理状态",
        "人工备注",
        "处理人",
        "处理时间",
        "主要问题",
        "证据摘要",
        "审核建议",
        "原始模型结论",
        "原始风险等级",
        "质检模式",
        "AI质检状态",
        "AI失败原因",
        "是否重试过",
        "最后质检时间",
        "纠错反馈类型",
        "纠错反馈备注",
        "建议补充规则",
        "反馈人",
        "反馈时间",
        "命中规则ID",
        "命中规则名称",
        "规则分类",
      ],
      ...visibleVideos.map(({ auditResult, ...video }) => {
        const finalDecision =
          video.finalDecision ||
          getFinalDecision(video, auditResult, video.manualReview);
        return [
          finalDecision.final_label,
          getFinalDecisionSourceLabel(finalDecision.source),
          finalDecision.final_reason,
          video.frontend_name,
          video.erp_name,
          video.operator,
          video.douyin_id,
          video.secUid,
          video.create_time,
          video.page_url,
          getDisplayAuditStatus(auditResult).label,
          finalDecision.final_status === "pending_review" ? "是" : "否",
          auditResult?.audit_result || "未质检",
          getManualReviewStatusLabel(
            getManualReviewStatus(auditResult, video.manualReview),
          ),
          video.manualReview?.note || "",
          video.manualReview?.reviewed_by_name || "",
          formatRunTime(video.manualReview?.reviewed_at),
          joinValues(auditResult?.main_risks) ||
            auditResult?.problem_description ||
            "",
          buildEvidenceSummary(auditResult),
          auditResult?.rectification_suggestion || "",
          auditResult?.audit_result || "未质检",
          auditResult?.risk_level || "",
          getAuditModeLabel(auditResult?.audit_mode),
          getVideoAuditStatusLabel(video, auditResult),
          getVideoAuditError(video, auditResult),
          video.ai_audit_retried ? "是" : "否",
          formatRunTime(video.ai_audit_last_at),
          getFeedbackTypeLabel(video.feedback?.type),
          video.feedback?.note || "",
          video.feedback?.suggested_rule || "",
          video.feedback?.feedback_by_name || "",
          formatRunTime(video.feedback?.feedback_at),
          joinValues(auditResult?.matched_rule_ids),
          joinValues(auditResult?.matched_rule_titles),
          joinValues(auditResult?.matched_rule_categories),
        ];
      }),
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
          `最终结论：${getFinalDecision(video, auditResult, video.manualReview).final_label}`,
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
    partialAccounts: accounts.filter(
      (account) =>
        ["partial_success", "pending_retry"].includes(account.status),
    ).length,
    failedAccounts: accounts.filter((account) => account.status === "failed")
      .length,
    videos: videos.length,
    notAudited: filterCounts.notAudited,
    passed: filterCounts.passed,
    human: filterCounts.human,
    rejected: filterCounts.rejected,
    failed: filterCounts.failed,
  };
  const manualReviewCounts = getManualReviewCounts(
    accountFilteredVideos,
    manualReviews,
  );
  const todayWorkbench = getTodayWorkbenchCounts(accountFilteredVideos);
  const feedbackCounts = getFeedbackCounts(accountFilteredVideos, feedbacks);
  const failedRetryVideos = accountFilteredVideos.filter(isVideoAuditFailed);
  const partialFetchAccounts = accounts.filter(
    (account) =>
      ["partial_success", "pending_retry"].includes(account.status),
  );
  const retryableFetchAccounts = accounts.filter((account) =>
    ["failed", "partial_success", "pending_retry"].includes(account.status),
  );
  const querySummary = buildQuerySummary({
    accountCount: accountTasks.length || recognizedSecUids.length,
    rangeType,
    startDate,
    endDate,
    videoCount: videos.length,
  });
  const profileSummary = buildProfileSummary(accountProfiles, accountProfileMeta);
  const currentRunStatus = buildCurrentRunStatus({
    videos: enrichedVideos,
    accounts,
    resultRange,
    accountCount: accountTasks.length || recognizedSecUids.length,
    isFetchingWorks: isLoading,
    isAuditing,
    auditProgress,
  });
  const hasFetchedVideos = videos.length > 0;
  const hasUnauditedVideos = videos.some((video) =>
    ["not_started", "pending"].includes(
      getVideoAuditStatus(video, auditResults[video.video_id]),
    ),
  );
  const canStartAiAudit =
    hasFetchedVideos && !isLoading && !isAuditing && !isRestoringRun;
  const aiAuditButtonLabel = getAiAuditButtonLabel({
    isFetchingWorks: isLoading,
    isAuditing,
    hasFetchedVideos,
    hasUnauditedVideos,
    videoCount: videos.length,
  });

  function jumpToWorkbench(status) {
    if (status === "not_audited") {
      setActiveFilter("notAudited");
    } else if (status === "pending_review") {
      setActiveFilter("human");
      setManualFilter("pending");
    } else if (status === "rejected") {
      setActiveFilter("human");
      setManualFilter("rejected");
    } else if (status === "ignored") {
      setActiveFilter("human");
      setManualFilter("ignored");
    } else if (status === "audit_failed") {
      setActiveFilter("failed");
    } else if (status === "publishable") {
      setActiveFilter("passed");
    }

    window.requestAnimationFrame(() => {
      document
        .querySelector(".douyin-workbench")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className="page-content douyin-audit-page">
      <header className="page-heading douyin-audit-heading">
        <span className="eyebrow">DOUYIN QUALITY WORKSPACE</span>
        <h1>抖音短视频质检</h1>
        <p>支持多账号、日期筛选、AI 视觉质检和人工复核筛选。</p>
        <div className="douyin-run-actions compact">
          <button
            type="button"
            onClick={() => {
              setIsHistoryOpen(true);
              loadHistoryRuns(historyScope);
            }}
          >
            历史记录
          </button>
          <button
            type="button"
            onClick={() => {
              setRunError("");
              setIsFeedbackSamplesOpen(true);
              loadFeedbackSamples(feedbackSampleScope, feedbackSampleType);
            }}
          >
            样本库
          </button>
          <button
            type="button"
            onClick={() => {
              setRuleError("");
              setRuleMessage("");
              setIsRulesOpen(true);
              loadAuditRules();
            }}
          >
            规则库
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
            {isRunSaving ? "保存中..." : "保存记录"}
          </button>
          <button type="button" className="danger" onClick={clearCurrentPage}>
            清空页面
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

      {currentRunStatus && (
        <div className="current-run-strip">
          <span>{currentRunStatus}</span>
          <button type="button" onClick={() => setIsQueryExpanded(true)}>
            重新设置查询条件
          </button>
        </div>
      )}

      {partialFetchAccounts.length > 0 && (
        <div className="douyin-run-message neutral">
          <strong>
            {"\u90e8\u5206\u8d26\u53f7\u83b7\u53d6\u4e0d\u5b8c\u6574\uff0c\u53ef\u5148\u8d28\u68c0\u5df2\u83b7\u53d6\u4f5c\u54c1\uff0c\u4e5f\u53ef\u4ee5\u7a0d\u540e\u91cd\u65b0\u83b7\u53d6\u8fd9\u4e9b\u8d26\u53f7\u3002"}
          </strong>
          <button type="button" onClick={retryProblemAccounts}>
            {"\u91cd\u8bd5\u5931\u8d25/\u90e8\u5206\u8d26\u53f7"}
          </button>
        </div>
      )}

      <form
        className={`douyin-audit-form douyin-query-card ${isQueryExpanded ? "is-expanded" : "is-collapsed"}`}
        onSubmit={handleSubmit}
      >
        <div className="douyin-collapsible-head">
          <div>
            <span className="card-kicker">01 / 查询条件</span>
            <strong>{querySummary}</strong>
          </div>
          <button
            type="button"
            onClick={() => setIsQueryExpanded((value) => !value)}
          >
            {isQueryExpanded ? "收起设置" : "展开设置"}
          </button>
        </div>
        <div className="douyin-query-intro">
          <span className="card-kicker">01 / 查询条件</span>
          <h2>批量获取账号作品</h2>
          <p>
            支持多个抖音账号批量抓取。可统一设置默认日期，也可为每个账号单独设置发布时间范围。
          </p>
        </div>

        <div className="douyin-audit-controls">
          <section className="douyin-profile-summary-card">
            <div>
              <span className="card-kicker">质检名单</span>
              <strong>账号资料库</strong>
              <p>{profileSummary}</p>
            </div>
            <button type="button" onClick={() => setIsAccountDrawerOpen(true)}>
              选择账号 / 管理名单
            </button>
          </section>

          <section className={`douyin-profile-library ${isAccountDrawerOpen ? "as-drawer" : "is-hidden"}`}>
            <button
              type="button"
              className="profile-drawer-close"
              onClick={() => setIsAccountDrawerOpen(false)}
            >
              关闭
            </button>
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

          {partialFetchAccounts.length > 0 && (
            <div className="douyin-partial-fetch-note">
              <strong>???????????</strong>
              <span>????? {videos.length} ???????? AI ????????????????</span>
            </div>
          )}

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
            {retryableFetchAccounts.length > 0 && (
              <button
                className="douyin-retry-fetch-button"
                type="button"
                onClick={handleRetryPendingAccounts}
                disabled={isLoading}
              >
                ?????????
              </button>
            )}
            <button
              className="douyin-ai-audit-button"
              type="button"
              onClick={handleAiAudit}
              disabled={!canStartAiAudit}
              title={
                hasFetchedVideos
                  ? ""
                  : "请先获取账号作品后再开始 AI 质检。"
              }
            >
              {aiAuditButtonLabel}
            </button>
          </div>
        </div>
      </form>

      {error && <ErrorBox title="获取失败" message={error} />}
      {auditError && <ErrorBox title="AI 质检失败" message={auditError} />}

      {(videos.length > 0 || hasSearched) && (
        <section className="today-workbench-section">
          <div className="douyin-section-title">
            <div>
              <span className="card-kicker">TODAY WORKBENCH</span>
              <h2>今日待处理</h2>
              <p>展示当前登录用户今天需要处理的视频状态。</p>
            </div>
          </div>
          <div className="today-workbench-grid">
            <button
              type="button"
              className="today-workbench-card status-not-audited"
              onClick={() => jumpToWorkbench("not_audited")}
            >
              <span>待AI质检</span>
              <strong>{todayWorkbench.notAudited}</strong>
            </button>
            <button
              type="button"
              className="today-workbench-card status-pending"
              onClick={() => jumpToWorkbench("pending_review")}
            >
              <span>待人工审核</span>
              <strong>{todayWorkbench.pendingReview}</strong>
            </button>
            <button
              type="button"
              className="today-workbench-card status-rejected"
              onClick={() => jumpToWorkbench("rejected")}
            >
              <span>退回修改</span>
              <strong>{todayWorkbench.rejected}</strong>
            </button>
            <button
              type="button"
              className="today-workbench-card status-failed"
              onClick={() => jumpToWorkbench("audit_failed")}
            >
              <span>质检失败</span>
              <strong>{todayWorkbench.auditFailed}</strong>
            </button>
            <button
              type="button"
              className="today-workbench-card status-passed"
              onClick={() => jumpToWorkbench("publishable")}
            >
              <span>今日已通过</span>
              <strong>{todayWorkbench.publishable}</strong>
            </button>
            <button
              type="button"
              className="today-workbench-card status-handled"
              onClick={() => setActiveFilter("all")}
            >
              <span>视频总数</span>
              <strong>{todayWorkbench.total}</strong>
            </button>
          </div>
        </section>
      )}

      {(videos.length > 0 || hasSearched) && (
        <section className={`douyin-overview-section task-detail-panel ${isTaskDetailsOpen ? "is-expanded" : "is-collapsed"}`}>
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
          <button
            type="button"
            className="task-detail-toggle"
            onClick={() => setIsTaskDetailsOpen((value) => !value)}
          >
            {isTaskDetailsOpen ? "收起任务详情" : "查看任务详情"}
          </button>
          <div className="douyin-overview-grid">
            <OverviewCard label="账号数" value={overview.accounts} />
            <OverviewCard
              label="成功账号"
              value={overview.successAccounts}
              tone="passed"
            />
            <OverviewCard
              label="??????"
              value={overview.partialAccounts}
              tone="human"
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
          {filterCounts.human > 0 && (
            <div className="douyin-manual-overview">
              <span>待审核 {manualReviewCounts.pending}</span>
              <span>退回修改 {manualReviewCounts.rejected}</span>
              <span>已忽略 {manualReviewCounts.ignored}</span>
            </div>
          )}
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
                  {getAccountFetchStatusText(account)}
                </span>
              ))}
              <small>抓取去重共 {totalFetched} 条原始作品</small>
            </div>
          )}
        </section>
      )}

      {auditProgress && (isAuditing || auditProgress.status === "completed") && (
        <section className="douyin-audit-progress">
          <div>
            <strong>{auditProgress.status === "completed" ? "质检完成" : "质检中"}</strong>
            <span>
              已完成 {auditProgress.completed} / {auditProgress.total}
            </span>
          </div>
          <div className="douyin-progress-stats">
            <span>已通过：{auditProgress.passed ?? 0}</span>
            <span>人工审核：{auditProgress.humanReview ?? 0}</span>
            <span>失败：{auditProgress.failed ?? 0}</span>
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
            {auditProgress.totalBatches} 批。当前处理：{summarizeText(auditProgress.currentVideo, 56, "等待中")}。
            系统将按每批 {AI_AUDIT_BATCH_SIZE} 条顺序质检，单条最多等待 90 秒，请勿关闭页面。
          </p>
        </section>
      )}

      {videos.length > 0 && (
        <section className={`douyin-workbench ${isMoreFiltersOpen ? "more-open" : "more-closed"}`}>
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
                  onClick={() => {
                    setActiveFilter(option.value);
                    if (option.value !== "human") setManualFilter("all");
                  }}
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
              <button
                type="button"
                className="more-filter-toggle"
                onClick={() => setIsMoreFiltersOpen((value) => !value)}
              >
                {isMoreFiltersOpen ? "收起更多" : "更多筛选"}
              </button>
            </div>
          </div>

          {activeFilter === "human" && (
            <div className="douyin-manual-filter-bar">
              {manualFilterOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={manualFilter === option.value ? "active" : ""}
                  onClick={() => setManualFilter(option.value)}
                >
                  {option.label}{" "}
                  {option.value === "all"
                    ? filterCounts.human
                    : manualReviewCounts[option.value]}
                </button>
              ))}
            </div>
          )}

          <div className="audit-feedback-filter">
            <span className="feedback-filter-title">纠错反馈筛选</span>
            <div className="feedback-filter-row">
              {feedbackFilterOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`feedback-filter-button ${
                    feedbackFilter === option.value ? "active" : ""
                  }`}
                  onClick={() => setFeedbackFilter(option.value)}
                >
                  {option.label}{" "}
                  {option.value === "all"
                    ? feedbackCounts.all
                    : option.value === "none"
                      ? feedbackCounts.none
                      : feedbackCounts[option.value]}
                </button>
              ))}
            </div>
          </div>

          <div className="douyin-batch-actions">
            <button type="button" onClick={() => setActiveFilter("human")}>
              只看人工审核
            </button>
            {failedRetryVideos.length > 0 && (
              <button
                type="button"
                onClick={retryFailedVideos}
                disabled={isAuditing}
              >
                {isAuditing
                  ? "重试中..."
                  : `重试失败视频 ${failedRetryVideos.length}`}
              </button>
            )}
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

          <div className="douyin-feedback-summary">
            <span>已反馈 {feedbackCounts.filled}</span>
            <span>AI 误判 {feedbackCounts.false_positive}</span>
            <span>AI 漏判 {feedbackCounts.false_negative}</span>
            <span>规则补充 {feedbackCounts.rule_gap}</span>
            <span>未反馈 {feedbackCounts.none}</span>
          </div>

          {visibleVideos.length > 0 ? (
            <div className="douyin-video-grid compact">
              {visibleVideos.map((video) => (
                <DouyinVideoCard
                  key={`${video.secUid}-${video.video_id}`}
                  video={video}
                  auditResult={video.auditResult}
                  manualReview={video.manualReview}
                  feedback={video.feedback}
                  onManualReviewChange={handleManualReviewChange}
                  onFeedbackChange={handleAiFeedbackChange}
                  onRetry={retryOneVideo}
                  onMarkAsHuman={markFailedVideoAsHuman}
                  onOpenDetails={(nextVideo, tab = "result") => {
                    setDetailVideoId(nextVideo.video_id);
                    setDetailTab(tab);
                  }}
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

      {detailVideo && (
        <div className="video-detail-drawer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="video-detail-backdrop"
            aria-label="关闭视频详情"
            onClick={() => setDetailVideoId("")}
          />
          <aside className="video-detail-panel">
            <header>
              <div>
                <span className="card-kicker">VIDEO DETAIL</span>
                <h2>视频详情</h2>
                <p>{detailVideo.frontend_name || detailVideo.author_name || "未知账号"}</p>
              </div>
              <button type="button" onClick={() => setDetailVideoId("")}>
                关闭
              </button>
            </header>
            <div className="video-detail-tabs">
              {[
                ["result", "质检结果"],
                ["manual", "人工处理"],
                ["feedback", "纠错反馈"],
                ["rules", "规则依据"],
                ["raw", "原始详情"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={detailTab === value ? "active" : ""}
                  onClick={() => setDetailTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="video-detail-content">
              {detailTab === "result" && (
                <AuditResultPanel
                  result={detailVideo.auditResult}
                  video={detailVideo}
                  isAuditing={isAuditing}
                />
              )}
              {detailTab === "manual" && (
                <ManualReviewPanel
                  result={detailVideo.auditResult}
                  manualReview={detailVideo.manualReview}
                  onChange={(patch, feedbackMessage) =>
                    handleManualReviewChange(detailVideo, patch, feedbackMessage)
                  }
                />
              )}
              {detailTab === "feedback" && (
                <AiFeedbackPanel
                  feedback={detailVideo.feedback}
                  onChange={(patch, feedbackMessage) =>
                    handleAiFeedbackChange(detailVideo, patch, feedbackMessage)
                  }
                />
              )}
              {detailTab === "rules" && (
                <RuleEvidencePanel result={detailVideo.auditResult} />
              )}
              {detailTab === "raw" && (
                <VideoRawDetail video={detailVideo} result={detailVideo.auditResult} />
              )}
            </div>
          </aside>
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
                      <span>可发布 {getRunSummaryCounts(run.summary).publishable}</span>
                      <span>待审 {getRunSummaryCounts(run.summary).pendingReview}</span>
                      <span>退回 {getRunSummaryCounts(run.summary).rejected}</span>
                      <span>失败 {getRunSummaryCounts(run.summary).auditFailed}</span>
                      <span>忽略 {getRunSummaryCounts(run.summary).ignored}</span>
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

      {isFeedbackSamplesOpen && (
        <div className="douyin-history-drawer" role="dialog" aria-modal="true">
          <button
            className="douyin-history-backdrop"
            type="button"
            aria-label="关闭质检样本库"
            onClick={() => setIsFeedbackSamplesOpen(false)}
          />
          <aside className="douyin-history-panel feedback-sample-panel">
            <header>
              <div>
                <span className="card-kicker">FEEDBACK SAMPLE LIBRARY</span>
                <h2>质检样本库</h2>
                <p>汇总全部用户沉淀的 AI 误判、漏判和规则补充样本。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsFeedbackSamplesOpen(false);
                  setRunError("");
                }}
              >
                关闭
              </button>
            </header>

            <div className="feedback-sample-toolbar">
              <div className="feedback-filter-row">
                <button
                  type="button"
                  className={`feedback-filter-button ${
                    feedbackSampleScope === "mine" ? "active" : ""
                  }`}
                  onClick={() => {
                    setFeedbackSampleScope("mine");
                    loadFeedbackSamples("mine", feedbackSampleType);
                  }}
                >
                  我的样本
                </button>
                {canViewAllAuditRuns && (
                  <button
                    type="button"
                    className={`feedback-filter-button ${
                      feedbackSampleScope === "all" ? "active" : ""
                    }`}
                    onClick={() => {
                      setFeedbackSampleScope("all");
                      loadFeedbackSamples("all", feedbackSampleType);
                    }}
                  >
                    全部样本
                  </button>
                )}
              </div>
              <div className="feedback-filter-row">
                {sampleFeedbackFilterOptions
                  .filter((option) => option.value !== "none")
                  .map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`feedback-filter-button ${
                        feedbackSampleType === option.value ? "active" : ""
                      }`}
                      onClick={() => {
                        setFeedbackSampleType(option.value);
                        loadFeedbackSamples(feedbackSampleScope, option.value);
                      }}
                    >
                      {option.label}{" "}
                      {option.value === "all"
                        ? feedbackSampleSummary?.total ?? 0
                        : feedbackSampleSummary?.[option.value] ?? 0}
                    </button>
                  ))}
              </div>
            </div>

            {feedbackSamples.length === 0 ? (
              <div className="douyin-history-empty">
                暂无质检样本。你可以在视频卡片中提交 AI 误判、AI 漏判或规则补充反馈，系统会自动沉淀到样本库。
              </div>
            ) : (
              <div className="feedback-sample-list">
                {feedbackSamples.map((sample) => (
                  <article
                    className="feedback-sample-card"
                    key={`${sample.run_id}-${sample.video_id}`}
                  >
                    {sample.cover_url && (
                      <img
                        src={sample.cover_url}
                        alt="视频封面"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div>
                      <strong>
                        {sample.account_name || sample.author_name || "未知账号"}
                      </strong>
                      <span>{sample.erp_name || "未填写 ERP"}｜{sample.douyin_id || "未填写抖音号"}</span>
                      <p>{sample.desc || "该视频暂无描述"}</p>
                      <small>
                        AI 结论：{sample.ai_result || "未记录"}｜风险等级：{sample.ai_risk_level || "未记录"}
                      </small>
                      <small>
                        人工处理：{getManualReviewStatusLabel(sample.manual_status)}
                        {sample.manual_note ? `｜人工备注：${sample.manual_note}` : ""}
                      </small>
                      <small>
                        反馈：{getFeedbackTypeLabel(sample.feedback_type)}｜反馈人：
                        {sample.feedback_by_name || "未知"}｜反馈时间：
                        {formatRunTime(sample.feedback_at)}
                      </small>
                      {sample.ai_problem && <p>AI 问题：{sample.ai_problem}</p>}
                      {sample.feedback_note && <p>反馈备注：{sample.feedback_note}</p>}
                      {sample.suggested_rule && (
                        <p>建议补充规则：{sample.suggested_rule}</p>
                      )}
                      {canViewAllAuditRuns &&
                        ["rule_gap", "false_positive", "false_negative"].includes(
                          sample.feedback_type,
                        ) && (
                          <button
                            type="button"
                            className="feedback-to-rule-button"
                            onClick={() => convertSampleToRule(sample)}
                          >
                            转为规则
                          </button>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {isRulesOpen && (
        <div className="douyin-history-drawer audit-rules-drawer" role="dialog" aria-modal="true">
          <button
            className="douyin-history-backdrop"
            type="button"
            aria-label="关闭质检规则库"
            onClick={() => {
              setIsRulesOpen(false);
              setRuleError("");
              setRuleMessage("");
            }}
          />
          <aside className="douyin-history-panel audit-rules-panel">
            <header>
              <div>
                <span className="card-kicker">AUDIT RULE LIBRARY</span>
                <h2>质检规则库</h2>
                <p>管理公司短视频审核规则，AI 质检时会优先参考已启用规则。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRulesOpen(false);
                  setRuleError("");
                  setRuleMessage("");
                }}
              >
                关闭
              </button>
            </header>

            <div className="audit-rules-toolbar">
              {canViewAllAuditRuns && (
                <button type="button" className="primary" onClick={() => openRuleCreate()}>
                  新增规则
                </button>
              )}
              <select
                value={ruleCategoryFilter}
                onChange={(event) => {
                  setRuleCategoryFilter(event.target.value);
                  loadAuditRules({ category: event.target.value });
                }}
              >
                <option value="all">全部分类</option>
                {ruleCategoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={ruleEnabledFilter}
                onChange={(event) => {
                  setRuleEnabledFilter(event.target.value);
                  loadAuditRules({ enabled: event.target.value });
                }}
              >
                <option value="1">仅启用</option>
                <option value="0">已停用</option>
                <option value="all">全部状态</option>
              </select>
              <input
                value={ruleKeyword}
                onChange={(event) => setRuleKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadAuditRules({ keyword: ruleKeyword });
                }}
                placeholder="搜索规则名称、关键词或说明"
              />
              <button type="button" onClick={() => loadAuditRules()}>
                搜索
              </button>
            </div>

            {ruleMessage && <div className="douyin-run-message success compact">{ruleMessage}</div>}
            {ruleError && <div className="douyin-run-message error compact">{ruleError}</div>}

            {isRuleFormOpen && (
              <form className="audit-rule-form as-side-drawer" onSubmit={saveRuleForm}>
                <div className="audit-rule-form-header">
                  <div>
                    <span className="card-kicker">RULE FORM</span>
                    <h3>{editingRuleId ? "编辑质检规则" : "新增质检规则"}</h3>
                    <p>按业务场景维护规则，保存后 AI 质检会优先参考已启用规则。</p>
                  </div>
                  <button type="button" onClick={() => setIsRuleFormOpen(false)}>
                    关闭
                  </button>
                </div>
                <div className="audit-rule-form-grid">
                  <label>规则名称 *
                    <input
                      value={ruleForm.title}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, title: event.target.value }))
                      }
                      required
                    />
                  </label>
                  <label>分类 *
                    <select
                      value={ruleForm.category}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, category: event.target.value }))
                      }
                    >
                      {ruleCategoryOptions.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>风险等级
                    <select
                      value={ruleForm.risk_level}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, risk_level: event.target.value }))
                      }
                    >
                      {["无", "低", "中", "高"].map((level) => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </label>
                  <label>处理建议
                    <select
                      value={ruleForm.decision}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, decision: event.target.value }))
                      }
                    >
                      <option value="通过">通过</option>
                      <option value="建议人工审核">建议人工审核</option>
                    </select>
                  </label>
                </div>
                <label>关键词（逗号、顿号或换行分隔）
                  <input
                    value={ruleForm.keywords}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, keywords: event.target.value }))
                    }
                    placeholder="国补、到手价、直播间福利"
                  />
                </label>
                <label>规则说明 *
                  <textarea
                    value={ruleForm.description}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, description: event.target.value }))
                    }
                    required
                  />
                </label>
                <div className="audit-rule-form-grid">
                  <label>正例
                    <textarea
                      value={ruleForm.positive_examples}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          positive_examples: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>反例
                    <textarea
                      value={ruleForm.negative_examples}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          negative_examples: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label>处理建议说明
                  <textarea
                    value={ruleForm.suggested_action}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        suggested_action: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="audit-rule-toggle">
                  <input
                    type="checkbox"
                    checked={ruleForm.enabled}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  启用该规则
                </label>
                {ruleForm.source_sample_id && (
                  <small>来源样本：{ruleForm.source_sample_id}</small>
                )}
                <div className="audit-rule-form-actions">
                  <button type="submit" className="primary">
                    {editingRuleId ? "保存修改" : "保存规则"}
                  </button>
                  <button type="button" onClick={() => setIsRuleFormOpen(false)}>
                    取消
                  </button>
                </div>
              </form>
            )}

            <div className="audit-rules-layout">
              <div className="audit-rule-list">
                {isRulesLoading ? (
                  <div className="douyin-history-empty">规则库加载中...</div>
                ) : auditRules.length === 0 ? (
                  <div className="douyin-history-empty">暂无规则。管理员可以新增第一条公司质检规则。</div>
                ) : (
                  auditRules.map((rule) => (
                    <article className="audit-rule-card" key={rule.id}>
                      <div>
                        <strong>{rule.title}</strong>
                        <span>{rule.category || "未分类"}｜{rule.risk_level || "中"}风险｜{rule.decision || "建议人工审核"}</span>
                      </div>
                      <p>{summarizeText(rule.description, 120, "暂无规则说明")}</p>
                      <div className="audit-rule-tags">
                        {(rule.keywords || []).slice(0, 8).map((keyword) => (
                          <span key={keyword}>{keyword}</span>
                        ))}
                        <span className={rule.enabled ? "enabled" : "disabled"}>
                          {rule.enabled ? "已启用" : "已停用"}
                        </span>
                      </div>
                      <small>更新：{formatRunTime(rule.updated_at)}｜创建人：{rule.created_by_name || "未知"}</small>
                      <div className="audit-rule-actions">
                        <button type="button" onClick={() => setSelectedRule(rule)}>
                          查看详情
                        </button>
                        {canViewAllAuditRuns && (
                          <>
                            <button type="button" onClick={() => openRuleEdit(rule)}>
                              编辑
                            </button>
                            <button type="button" onClick={() => toggleRule(rule)}>
                              {rule.enabled ? "停用" : "启用"}
                            </button>
                            <button type="button" className="danger" onClick={() => deleteRule(rule)}>
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>

              <aside className="audit-rule-detail">
                {selectedRule ? (
                  <>
                    <span className="card-kicker">RULE DETAIL</span>
                    <h3>{selectedRule.title}</h3>
                    <p>{selectedRule.description || "暂无规则说明"}</p>
                    <dl>
                      <dt>分类</dt><dd>{selectedRule.category || "-"}</dd>
                      <dt>风险等级</dt><dd>{selectedRule.risk_level || "-"}</dd>
                      <dt>处理建议</dt><dd>{selectedRule.decision || "-"}</dd>
                      <dt>关键词</dt><dd>{joinValues(selectedRule.keywords) || "-"}</dd>
                      <dt>正例</dt><dd>{joinValues(selectedRule.positive_examples) || "-"}</dd>
                      <dt>反例</dt><dd>{joinValues(selectedRule.negative_examples) || "-"}</dd>
                      <dt>处理建议说明</dt><dd>{selectedRule.suggested_action || "-"}</dd>
                      <dt>来源样本</dt><dd>{selectedRule.source_sample_id || "-"}</dd>
                      <dt>更新时间</dt><dd>{formatRunTime(selectedRule.updated_at)}</dd>
                    </dl>
                  </>
                ) : (
                  <div className="douyin-history-empty">点击规则卡片查看完整详情。</div>
                )}
              </aside>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function DouyinVideoCard({
  video,
  auditResult,
  manualReview,
  feedback,
  onManualReviewChange,
  onFeedbackChange,
  onRetry,
  onMarkAsHuman,
  onOpenDetails,
  isAuditing,
}) {
  const [expanded, setExpanded] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const finalDecision =
    video.finalDecision || getFinalDecision(video, auditResult, manualReview);

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
        <div className="douyin-video-meta final-aware">
          <div>
            <span>
              {video.frontend_name || video.author_name || "未知作者"}
            </span>
            <time>{video.create_time || "发布时间未知"}</time>
          </div>
          <div className={`final-decision-badge status-${finalDecision.final_status}`}>
            <strong>最终结论：{finalDecision.final_label}</strong>
            <small>来源：{finalDecision.final_reason}</small>
          </div>
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
        <CompactAuditSummary
          result={auditResult}
          video={video}
          finalDecision={finalDecision}
          isAuditing={isAuditing}
        />

        <div className="douyin-card-actions">
          <a href={video.page_url} target="_blank" rel="noreferrer">
            打开视频 ↗
          </a>
          <button type="button" onClick={() => onOpenDetails(video, "result")}>
            查看详情
          </button>
          {finalDecision.final_status === "pending_review" && (
            <button type="button" onClick={() => onOpenDetails(video, "manual")}>
              人工处理
            </button>
          )}
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起视频信息" : "展开视频信息"}
          </button>
          {isVideoAuditFailed(video) && (
            <>
              <button
                type="button"
                onClick={() => onRetry(video)}
                disabled={isAuditing}
              >
                重新质检
              </button>
              <button
                type="button"
                onClick={() => onMarkAsHuman(video)}
                disabled={isAuditing}
              >
                标记为人工审核
              </button>
            </>
          )}
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

function CompactAuditSummary({ result, video, finalDecision, isAuditing }) {
  const videoAuditStatus = getVideoAuditStatus(video, result);

  if (!result) {
    return (
      <div className="compact-audit-summary pending">
        <span>
          {videoAuditStatus === "auditing"
            ? "质检中"
            : isAuditing || videoAuditStatus === "pending"
              ? "等待质检"
              : "尚未开始 AI 质检"}
        </span>
        <p>点击「开始 AI 质检」后，这里会显示最终结论和主要问题。</p>
      </div>
    );
  }

  const mainRisks = Array.isArray(result.main_risks) ? result.main_risks : [];
  const problem =
    finalDecision.final_status === "publishable"
      ? "未发现明显风险，可正常发布。"
      : finalDecision.final_status === "audit_failed"
        ? getVideoAuditError(video, result) || "该视频质检失败，建议重试或人工查看。"
        : summarizeText(
            result.problem_description || mainRisks.join("；"),
            86,
            "建议人工查看该视频内容。",
          );

  return (
    <div className={`compact-audit-summary status-${finalDecision.final_status}`}>
      <span>主要问题</span>
      <p>{problem}</p>
    </div>
  );
}

function RuleEvidencePanel({ result }) {
  const hitRules = Array.isArray(result?.hit_rules) ? result.hit_rules : [];
  const matchedRuleTitles =
    Array.isArray(result?.matched_rule_titles) && result.matched_rule_titles.length > 0
      ? result.matched_rule_titles
      : hitRules;

  return (
    <section className="rule-evidence-panel">
      <h3>规则依据</h3>
      <AuditList
        label="规则依据"
        values={matchedRuleTitles}
        emptyText="未匹配到公司规则"
      />
      <AuditList
        label="规则 ID"
        values={Array.isArray(result?.matched_rule_ids) ? result.matched_rule_ids : []}
        emptyText="无"
        code
      />
      <AuditList
        label="规则分类"
        values={
          Array.isArray(result?.matched_rule_categories)
            ? result.matched_rule_categories
            : []
        }
        emptyText="无"
      />
    </section>
  );
}

function VideoRawDetail({ video, result }) {
  return (
    <section className="video-raw-detail">
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
        <details className="douyin-play-url" open>
          <summary>程序播放链接</summary>
          <a href={video.play_url} target="_blank" rel="noreferrer">
            {video.play_url}
          </a>
        </details>
      )}
      {SHOW_AUDIT_DEBUG && result?.debug && <AuditDebugDetails debug={result.debug} />}
    </section>
  );
}

function AuditResultPanel({ result, video, isAuditing }) {
  const videoAuditStatus = getVideoAuditStatus(video, result);
  const videoAuditError = getVideoAuditError(video, result);

  if (!result) {
    return (
      <div className="douyin-ai-placeholder">
        <span>
          {videoAuditStatus === "auditing"
            ? "该视频质检中"
            : isAuditing || videoAuditStatus === "pending"
              ? "等待质检"
              : "尚未开始 AI 质检"}
        </span>
      </div>
    );
  }

  const mainRisks = Array.isArray(result.main_risks) ? result.main_risks : [];
  const hitRules = Array.isArray(result.hit_rules) ? result.hit_rules : [];
  const matchedRuleTitles =
    Array.isArray(result.matched_rule_titles) && result.matched_rule_titles.length > 0
      ? result.matched_rule_titles
      : hitRules;
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

      {matchedRuleTitles.length > 0 && (
        <div className="douyin-ai-rule-summary">
          <span>规则依据</span>
          <p>{matchedRuleTitles.join("、")}</p>
        </div>
      )}

      {displayStatus.key === "failed" && (
        <div className="douyin-ai-failure-reason">
          <span>质检失败原因</span>
          <p>{friendlyAuditError(videoAuditError || result.error_message || result.visual_error)}</p>
        </div>
      )}

      <details className="douyin-ai-full-details">
        <summary>展开完整质检详情</summary>
        <div>
          <AuditDetail
            label="原始模型结论"
            value={`${result.audit_result || "无"} / ${result.risk_level || "无"}风险`}
          />
          <AuditList label="规则依据" values={matchedRuleTitles} emptyText="未匹配到公司规则" />
          <AuditList
            label="规则ID"
            values={Array.isArray(result.matched_rule_ids) ? result.matched_rule_ids : []}
            emptyText="无"
            code
          />
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
          <ConsistencyCheckPanel result={result} />
          {SHOW_AUDIT_DEBUG && result.debug && (
            <AuditDebugDetails debug={result.debug} />
          )}
        </div>
      </details>
    </section>
  );
}

function ManualReviewPanel({ result, manualReview, onChange }) {
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(manualReview?.note || "");
  const displayStatus = getDisplayAuditStatus(result);

  useEffect(() => {
    setDraftNote(manualReview?.note || "");
  }, [manualReview?.note]);

  if (displayStatus.key !== "human") {
    return null;
  }

  const review = manualReview || createPendingManualReview();
  const status = review.status || "pending";
  const statusMessages = {
    approved: "已人工确认通过。",
    rejected: "已标记为退回修改。",
    ignored: "已忽略该条人工审核。",
  };

  function updateStatus(nextStatus) {
    onChange(
      {
        status: nextStatus,
        note: nextStatus === "rejected" ? draftNote || review.note || "" : review.note || "",
      },
      statusMessages[nextStatus] || "人工处理结果已保存。",
    );
    if (nextStatus === "rejected") {
      setIsEditingNote(true);
    }
  }

  function saveNote() {
    onChange(
      {
        status,
        note: draftNote,
        touch: true,
      },
      "备注已保存。",
    );
    setIsEditingNote(false);
  }

  return (
    <section className={`manual-review-panel status-${status}`}>
      <header>
        <div>
          <span>人工处理</span>
          <strong>{getManualReviewStatusLabel(status)}</strong>
        </div>
        <div className="manual-review-actions">
          <button type="button" onClick={() => updateStatus("approved")}>
            确认通过
          </button>
          <button type="button" onClick={() => updateStatus("rejected")}>
            退回修改
          </button>
          <button type="button" onClick={() => updateStatus("ignored")}>
            忽略
          </button>
          <button type="button" onClick={() => setIsEditingNote((value) => !value)}>
            {review.note ? "编辑备注" : "添加备注"}
          </button>
        </div>
      </header>

      {review.note && (
        <p className="manual-review-note">
          <b>人工备注：</b>
          {review.note}
        </p>
      )}

      {(review.reviewed_by_name || review.reviewed_at) && (
        <p className="manual-review-meta">
          {review.reviewed_by_name && <>处理人：{review.reviewed_by_name}</>}
          {review.reviewed_at && <> ｜ 处理时间：{formatRunTime(review.reviewed_at)}</>}
        </p>
      )}

      {isEditingNote && (
        <div className="manual-review-note-editor">
          <textarea
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
            placeholder="填写人工审核备注，例如退回原因、确认依据或暂不处理说明。"
            rows={3}
          />
          <button type="button" onClick={saveNote}>
            保存备注
          </button>
        </div>
      )}
    </section>
  );
}

function AiFeedbackPanel({ feedback, onChange }) {
  const currentFeedback = normalizeFeedback(feedback);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedType, setSelectedType] = useState(
    ["false_positive", "false_negative", "rule_gap"].includes(currentFeedback.type)
      ? currentFeedback.type
      : "false_positive",
  );
  const [draftNote, setDraftNote] = useState(feedback?.note || "");
  const [draftRule, setDraftRule] = useState(feedback?.suggested_rule || "");

  useEffect(() => {
    const normalized = normalizeFeedback(feedback);
    if (["false_positive", "false_negative", "rule_gap"].includes(normalized.type)) {
      setSelectedType(normalized.type);
    }
    setDraftNote(feedback?.note || "");
    setDraftRule(feedback?.suggested_rule || "");
  }, [feedback?.type, feedback?.note, feedback?.suggested_rule]);

  function saveFeedbackDetail() {
    onChange(
      {
        type: selectedType,
        note: draftNote,
        suggested_rule: selectedType === "rule_gap" ? draftRule : "",
      },
      "纠错反馈已保存。",
    );
    setIsEditing(false);
  }

  function deleteFeedback() {
    onChange({ _delete: true }, "纠错反馈已删除。");
    setIsEditing(false);
    setDraftNote("");
    setDraftRule("");
  }

  const hasFeedback = Boolean(currentFeedback.type);
  const isRuleGap = selectedType === "rule_gap";
  const placeholder = {
    false_positive:
      "请说明为什么认为 AI 误判，例如：国补价格已与后台活动一致，可正常发布。",
    false_negative:
      "请说明 AI 漏掉了什么风险，例如：标题出现绝对化用语，或画面存在站外导流。",
    rule_gap: "请说明这类场景为什么需要沉淀为公司规则。",
  }[selectedType];

  return (
    <section className={`ai-feedback-panel type-${currentFeedback.type || "none"}`}>
      <header>
        <div>
          <span>纠错反馈</span>
          <strong>
            {hasFeedback
              ? getFeedbackTypeLabel(currentFeedback.type)
              : "如果 AI 判断不准确，可在这里反馈"}
          </strong>
        </div>
        <button type="button" onClick={() => setIsEditing((value) => !value)}>
          {hasFeedback ? "编辑反馈" : "我要纠错 / 补充规则"}
        </button>
      </header>

      {hasFeedback && !isEditing && (
        <div className="ai-feedback-current">
          <p>纠错反馈：{getFeedbackTypeLabel(currentFeedback.type)}</p>
          {currentFeedback.note && <p>反馈备注：{currentFeedback.note}</p>}
          {currentFeedback.suggested_rule && (
            <p>建议补充规则：{currentFeedback.suggested_rule}</p>
          )}
          {(currentFeedback.feedback_by_name || currentFeedback.feedback_at) && (
            <small>
              {currentFeedback.feedback_by_name && `反馈人：${currentFeedback.feedback_by_name}`}
              {currentFeedback.feedback_at && ` · 反馈时间：${formatRunTime(currentFeedback.feedback_at)}`}
            </small>
          )}
        </div>
      )}

      {isEditing && (
        <div className="ai-feedback-editor">
          <p className="ai-feedback-help">
            如果你认为 AI 判断不准确，或需要补充公司规则，可在这里反馈。
          </p>
          <div className="ai-feedback-actions">
            {feedbackTypeOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={selectedType === option.value ? "active" : ""}
                onClick={() => setSelectedType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <textarea
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
            placeholder={placeholder}
            rows={3}
          />
          {isRuleGap && (
            <textarea
              value={draftRule}
              onChange={(event) => setDraftRule(event.target.value)}
              placeholder="请写出建议沉淀到规则库的审核规则。"
              rows={2}
            />
          )}
          <div className="ai-feedback-editor-actions">
            <button type="button" onClick={saveFeedbackDetail}>
              保存反馈
            </button>
            {hasFeedback && (
              <button type="button" className="danger" onClick={deleteFeedback}>
                删除反馈
              </button>
            )}
          </div>
        </div>
      )}
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

function ConsistencyCheckPanel({ result }) {
  if (!result) return null;

  const evidencePoints = Array.isArray(result.evidence_points)
    ? result.evidence_points
    : [];
  const hasInfo =
    result.normalized_content_key ||
    result.reused_audit_result ||
    result.consistency_warning ||
    result.consistency_related_video_id ||
    result.post_process_reason ||
    evidencePoints.length > 0;

  if (!hasInfo) return null;

  return (
    <section className="consistency-check-panel">
      <span>一致性检查</span>
      <dl>
        <dt>复用相似结果</dt>
        <dd>{result.reused_audit_result ? "是" : "否"}</dd>
        <dt>内容指纹</dt>
        <dd><code>{result.normalized_content_key || "-"}</code></dd>
        <dt>结论冲突提示</dt>
        <dd>{result.consistency_warning ? "发现相似视频结论不同" : "未发现"}</dd>
        <dt>关联视频 ID</dt>
        <dd>{result.consistency_related_video_id || result.reused_from_video_id || "-"}</dd>
        <dt>后处理原因</dt>
        <dd>{result.post_process_reason || "-"}</dd>
      </dl>
      {evidencePoints.length > 0 && (
        <div className="evidence-points-list">
          <strong>模型证据点</strong>
          {evidencePoints.map((point, index) => (
            <article key={`${point.source || "evidence"}-${index}`}>
              <span>{point.source || "evidence"}</span>
              <p>{point.text || "未提供原文/画面描述"}</p>
              <small>{point.reason || "未提供原因"}</small>
            </article>
          ))}
        </div>
      )}
    </section>
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
            <pre>（未匹配到公司规则）</pre>
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

function formatAccountTaskForRequest(task) {
  return task.rangeType === "default"
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
        startDate: normalizeDateForApi(task.startDate),
        endDate: normalizeDateForApi(task.endDate),
      };
}

function mergeVideosByIdentity(existingVideos, incomingVideos) {
  const merged = [];
  const indexByKey = new Map();

  for (const video of [...(existingVideos || []), ...(incomingVideos || [])]) {
    const key = getVideoIdentityKey(video);

    if (!key) {
      merged.push(video);
      continue;
    }

    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      const existingVideo = merged[index];
      merged[index] = {
        ...existingVideo,
        ...video,
        ai_audit_status:
          existingVideo.ai_audit_status || video.ai_audit_status || "not_started",
        ai_audit_error: existingVideo.ai_audit_error || video.ai_audit_error || "",
        ai_audit_last_at:
          existingVideo.ai_audit_last_at || video.ai_audit_last_at || "",
        ai_audit_retried:
          existingVideo.ai_audit_retried || video.ai_audit_retried || false,
        auditResult: existingVideo.auditResult,
      };
    } else {
      indexByKey.set(key, merged.length);
      merged.push(video);
    }
  }

  return merged
    .sort(
      (left, right) =>
        Number(right.create_time_ts) - Number(left.create_time_ts),
    )
    .map((video, index) => ({ ...video, index: index + 1 }));
}

function mergeAccountsBySecUid(existingAccounts, incomingAccounts) {
  const merged = new Map();

  for (const account of existingAccounts || []) {
    merged.set(normalizeClientSecUid(account.secUid), account);
  }

  for (const account of incomingAccounts || []) {
    merged.set(normalizeClientSecUid(account.secUid), account);
  }

  return [...merged.values()].sort(
    (left, right) => Number(left.account_index) - Number(right.account_index),
  );
}

function getVideoIdentityKey(video) {
  return String(
    video?.video_id || video?.aweme_id || video?.item_id || video?.share_url || "",
  ).trim();
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

function stripClientOnlyVideoFields(video) {
  const {
    auditResult: _auditResult,
    manualReview: _manualReview,
    ...plainVideo
  } = video || {};
  return plainVideo;
}

function removeAuditResultsForIds(results, ids) {
  return Object.fromEntries(
    Object.entries(results || {}).filter(([videoId]) => !ids.has(videoId)),
  );
}

function markVideosForAudit(videos, ids, { status, error = "", retried = false }) {
  return videos.map((video) =>
    ids.has(video.video_id)
      ? {
          ...video,
          ai_audit_status: status,
          ai_audit_error: error,
          ai_audit_retried: Boolean(video.ai_audit_retried || retried),
        }
      : video,
  );
}

function normalizeBatchResults(batch, payload) {
  const resultMap = new Map();
  for (const result of Array.isArray(payload?.results) ? payload.results : []) {
    for (const key of [
      result?.video_id,
      result?.source_video_id,
      result?.stable_id,
    ]) {
      if (key && !resultMap.has(key)) {
        resultMap.set(key, result);
      }
    }
  }

  return batch.map((video) => {
    const result = resultMap.get(video.video_id);
    if (!result) {
      return buildClientAuditFailure(video, "AI 返回缺少该视频结果，建议重新质检。");
    }

    const auditStatus = normalizeAuditResultStatus(result);
    const isFailed = ["failed", "timeout", "error"].includes(auditStatus);
    return {
      ...result,
      audit_status: auditStatus,
      error_message: isFailed
        ? friendlyAuditError(result.error_message || result.visual_error || "")
        : result.error_message || "",
    };
  });
}

function applyAuditResultsToVideos(videos, batch, results, retried = false) {
  const batchIds = new Set(batch.map((video) => video.video_id));
  const resultMap = new Map();
  for (const result of results) {
    for (const key of [
      result?.video_id,
      result?.source_video_id,
      result?.stable_id,
    ]) {
      if (key && !resultMap.has(key)) {
        resultMap.set(key, result);
      }
    }
  }
  const now = new Date().toISOString();

  return videos.map((video) => {
    if (!batchIds.has(video.video_id)) return video;
    const result = resultMap.get(video.video_id);
    const status = normalizeAuditResultStatus(result);
    const isFailed = ["failed", "timeout", "error"].includes(status);

    return {
      ...video,
      ai_audit_status: status,
      ai_audit_error: isFailed ? getVideoAuditError(video, result) : "",
      ai_audit_retried: Boolean(video.ai_audit_retried || retried),
      ai_audit_last_at: now,
    };
  });
}

function normalizeAuditResultStatus(result) {
  const status = String(result?.audit_status || "").toLowerCase();
  if (["not_started", "pending", "auditing", "completed", "failed", "timeout", "error"].includes(status)) {
    return status;
  }
  return result ? "completed" : "not_started";
}

function getVideoAuditStatus(video, result = null) {
  const status = String(video?.ai_audit_status || "").toLowerCase();
  if (["not_started", "pending", "auditing", "completed", "failed", "timeout", "error"].includes(status)) {
    return status;
  }
  if (result) return normalizeAuditResultStatus(result);
  return "not_started";
}

function getVideoAuditStatusLabel(video, result = null) {
  const status = getVideoAuditStatus(video, result);
  return AUDIT_STATUS_LABELS[status] || "未质检";
}

function isVideoAuditFailed(video) {
  return ["failed", "timeout", "error"].includes(
    getVideoAuditStatus(video, video?.auditResult),
  );
}

function getVideoAuditError(video, result = null) {
  return friendlyAuditError(
    video?.ai_audit_error ||
      result?.error_message ||
      result?.visual_error ||
      result?.problem_description ||
      "",
  );
}

function friendlyAuditError(value) {
  const message = String(value || "").trim();
  if (!message) return "";
  const lower = message.toLowerCase();

  if (/timeout|超时|timed out/.test(lower)) {
    return "该视频质检超时，建议稍后重试或人工查看。";
  }
  if (/video_url|play_url|无法访问|invalid.*url|not accessible|403|404/.test(lower)) {
    return "视频播放链接不可访问，建议打开原视频人工查看。";
  }
  if (/format|mime|unsupported|格式/.test(lower)) {
    return "当前视频格式可能不支持视觉质检，建议人工查看。";
  }
  if (/json|parse|格式异常|invalid json/.test(lower)) {
    return "AI 返回格式异常，建议重新质检。";
  }
  if (/model|provider|api|responses|接口|模型|ark|limit|429/.test(lower)) {
    return "AI 模型接口异常，请稍后重试。";
  }

  return message;
}

function buildClientAuditFailure(video, message) {
  const friendlyMessage = friendlyAuditError(message || "AI 质检失败");
  const isTimeout = /超时|timeout/i.test(message || "");

  return {
    video_id: video.video_id,
    source_video_id: video.source_video_id || video.video_id,
    stable_id: video.stable_id || video.video_id,
    normalized_content_key: video.normalized_content_key || "",
    secUid: video.secUid,
    account_index: video.account_index,
    author_name: video.author_name,
    frontend_name: video.frontend_name,
    erp_name: video.erp_name,
    operator: video.operator,
    douyin_id: video.douyin_id,
    profile_matched: video.profile_matched,
    account_range_label: video.account_range_label,
    audit_result: "建议人工复核",
    risk_level: "未知",
    main_risks: [isTimeout ? "AI质检超时" : "AI质检失败"],
    hit_rules: [],
    evidence: "",
    visual_evidence: "",
    evidence_points: [],
    problem_description: friendlyMessage,
    rectification_suggestion: "建议稍后重新质检，或打开原视频人工查看。",
    need_human_review: true,
    audit_status: isTimeout ? "timeout" : "failed",
    audit_mode: "failed",
    visual_status: isTimeout ? "timeout" : "failed",
    visual_error: friendlyMessage,
    error_message: friendlyMessage,
  };
}

function readBooleanPreference(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "1";
  } catch {
    return fallback;
  }
}

function writeBooleanPreference(key, value) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Ignore storage failures in private mode.
  }
}

function getAiAuditButtonLabel({
  isFetchingWorks,
  isAuditing,
  hasFetchedVideos,
  hasUnauditedVideos,
  videoCount = 0,
}) {
  if (isFetchingWorks) return "正在获取作品...";
  if (isAuditing) return "AI质检中...";
  if (!hasFetchedVideos) return "请先获取账号作品";
  if (hasUnauditedVideos) return `开始 AI 质检（已获取 ${videoCount} 条）`;
  return `重新 AI 质检（已获取 ${videoCount} 条）`;
}

function buildQuerySummary({ accountCount, rangeType, startDate, endDate, videoCount }) {
  const rangeLabel =
    rangeType === "custom"
      ? `${startDate || "-"} 至 ${endDate || "-"}`
      : getRangeLabel(rangeType);
  const videoText = videoCount > 0 ? ` · 共 ${videoCount} 条视频` : "";
  return `已选择 ${accountCount || 0} 个账号 · ${rangeLabel}${videoText}`;
}

function buildProfileSummary(accountProfiles, accountProfileMeta) {
  if (!accountProfiles.length) {
    return "还未上传质检名单，可手动输入 secUid，也可以先导入名单后批量选择账号。";
  }

  return `已导入 ${accountProfiles.length} 个账号 · 可用 ${accountProfileMeta?.stats?.valid_uid_count ?? accountProfiles.length} · 缺失 ${accountProfileMeta?.stats?.missing_uid_count ?? 0} · 重复 ${accountProfileMeta?.stats?.duplicate_uid_count ?? 0}`;
}

function buildCurrentRunStatus({
  videos,
  accounts,
  resultRange,
  accountCount,
  isFetchingWorks,
  isAuditing,
  auditProgress,
}) {
  if (isFetchingWorks) {
    return `正在获取作品 · 已识别 ${accountCount || 0} 个账号`;
  }

  if (isAuditing) {
    return `AI 质检中：${auditProgress?.completed || 0} / ${
      auditProgress?.total || videos.length || 0
    }`;
  }

  if ((videos || []).length === 0) {
    return accountCount > 0
      ? `已识别 ${accountCount} 个账号，等待获取作品`
      : "";
  }

  const finalCounts = getFinalDecisionCounts(videos);
  if (finalCounts.not_audited === videos.length) {
    return `已获取 ${videos.length} 条视频，待 AI 质检`;
  }

  const rangeLabel = resultRange
    ? `${getRangeLabel(resultRange.rangeType)} · ${resultRange.startDate || "-"} 至 ${resultRange.endDate || "-"}`
    : "未标注范围";
  return `AI 质检完成：可发布 ${finalCounts.publishable}，待人工审核 ${finalCounts.pending_review}，失败 ${finalCounts.audit_failed} · 账号 ${accounts.length} · 视频 ${videos.length} · ${rangeLabel}`;
}

function buildManualFallbackAuditResult(video) {
  return {
    video_id: video.video_id,
    secUid: video.secUid,
    account_index: video.account_index,
    author_name: video.author_name,
    frontend_name: video.frontend_name,
    erp_name: video.erp_name,
    operator: video.operator,
    douyin_id: video.douyin_id,
    profile_matched: video.profile_matched,
    account_range_label: video.account_range_label,
    audit_result: "建议人工复核",
    risk_level: "未知",
    main_risks: ["AI质检失败，建议人工查看"],
    hit_rules: [],
    evidence: "",
    visual_evidence: "",
    problem_description: "AI质检失败，已转入人工审核。",
    rectification_suggestion: "请运营打开原视频进行人工判断。",
    need_human_review: true,
    audit_status: "completed",
    audit_mode: "manual_fallback",
    visual_status: "manual_review",
    visual_error: "",
    error_message: "",
  };
}

function getProgressCounts(auditResults) {
  const summary = getAuditSummary(Object.values(auditResults || {}));
  return {
    passed: summary.passed,
    humanReview: summary.humanReview,
    failed: summary.failed,
  };
}

function buildAuditRunTitle(accountCount, videoCount) {
  return `短视频质检 - 账号数 ${accountCount} - 视频数 ${videoCount} - ${formatRunTime(new Date().toISOString())}`;
}

function buildPersistedRunSummary({
  accounts,
  videos,
  auditResults,
  manualReviews,
  feedbacks,
  auditSummary,
  resultRange,
  totalFetched,
}) {
  const enriched = videos.map((video) => ({
    ...video,
    auditResult: auditResults[video.video_id] ?? null,
    manualReview: manualReviews?.[video.video_id] ?? null,
    feedback: feedbacks?.[video.video_id] ?? null,
  })).map((video) => ({
    ...video,
    finalDecision: getFinalDecision(video, video.auditResult, video.manualReview),
  }));
  const counts = getFilterCounts(enriched);
  const manualCounts = getManualReviewCounts(enriched, manualReviews);
  const feedbackCounts = getFeedbackCounts(enriched, feedbacks);
  const finalCounts = getFinalDecisionCounts(enriched);

  return {
    account_count: accounts.length,
    success_account_count: accounts.filter((account) => account.status === "success").length,
    partial_account_count: accounts.filter((account) =>
      ["partial_success", "pending_retry"].includes(account.status),
    ).length,
    failed_account_count: accounts.filter((account) => account.status === "failed").length,
    video_count: videos.length,
    total: videos.length,
    passed: counts.passed,
    humanReview: counts.human,
    failed: counts.failed,
    finalDecisionCounts: finalCounts,
    notAudited: finalCounts.not_audited,
    publishable: finalCounts.publishable,
    pendingReview: finalCounts.pending_review,
    rejected: finalCounts.rejected,
    auditFailed: finalCounts.audit_failed,
    ignored: finalCounts.ignored,
    manualReviewCounts: manualCounts,
    feedbackCounts,
    totalFetched: Number(totalFetched) || 0,
    resultRange,
    auditSummary,
    filter_counts: counts,
  };
}

function getFinalDecisionCounts(videos) {
  const counts = {
    not_audited: 0,
    publishable: 0,
    pending_review: 0,
    rejected: 0,
    audit_failed: 0,
    ignored: 0,
  };

  for (const video of videos || []) {
    const decision =
      video.finalDecision ||
      getFinalDecision(video, video.auditResult, video.manualReview);
    if (Object.hasOwn(counts, decision.final_status)) {
      counts[decision.final_status] += 1;
    }
  }

  return counts;
}

function getTodayWorkbenchCounts(videos) {
  const finalCounts = getFinalDecisionCounts(videos);
  const handled = (videos || []).filter((video) =>
    ["approved", "rejected", "ignored"].includes(video.manualReview?.status),
  ).length;

  return {
    total: (videos || []).length,
    notAudited: finalCounts.not_audited,
    pendingReview: finalCounts.pending_review,
    rejected: finalCounts.rejected,
    auditFailed: finalCounts.audit_failed,
    publishable: finalCounts.publishable,
    handled,
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

function normalizeManualReviewsMap(value, auditResults = {}) {
  const base =
    value && !Array.isArray(value) && typeof value === "object" ? value : {};
  return initializeManualReviews(
    auditResults,
    Object.fromEntries(
      Object.entries(base).map(([videoId, review]) => [
        videoId,
        normalizeManualReview(review),
      ]),
    ),
  );
}

function normalizeFeedbacksMap(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([videoId, feedback]) => [
      videoId,
      normalizeFeedback(feedback),
    ]),
  );
}

function initializeManualReviews(auditResults, currentReviews = {}) {
  const next = { ...currentReviews };

  for (const [videoId, result] of Object.entries(auditResults || {})) {
    if (
      getDisplayAuditStatus(result).key === "human" &&
      !next[videoId]
    ) {
      next[videoId] = createPendingManualReview();
    }
  }

  return next;
}

function createPendingManualReview() {
  return {
    status: "pending",
    note: "",
    reviewed_by: "",
    reviewed_by_name: "",
    reviewed_at: "",
  };
}

function normalizeManualReview(value) {
  const allowed = ["pending", "approved", "rejected", "ignored"];
  return {
    status: allowed.includes(value?.status) ? value.status : "pending",
    note: String(value?.note ?? ""),
    reviewed_by: String(value?.reviewed_by ?? ""),
    reviewed_by_name: String(value?.reviewed_by_name ?? ""),
    reviewed_at: String(value?.reviewed_at ?? ""),
  };
}

function createEmptyFeedback() {
  return {
    type: "",
    note: "",
    suggested_rule: "",
    feedback_by: "",
    feedback_by_name: "",
    feedback_at: "",
  };
}

function normalizeFeedback(value) {
  const allowed = [
    "correct",
    "false_positive",
    "false_negative",
    "rule_gap",
    "uncertain",
  ];
  return {
    type: allowed.includes(value?.type) ? value.type : "",
    note: String(value?.note ?? ""),
    suggested_rule: String(value?.suggested_rule ?? ""),
    feedback_by: String(value?.feedback_by ?? ""),
    feedback_by_name: String(value?.feedback_by_name ?? ""),
    feedback_at: String(value?.feedback_at ?? ""),
  };
}

function getFeedbackTypeLabel(type) {
  return {
    correct: "AI判断正确",
    false_positive: "AI误判",
    false_negative: "AI漏判",
    rule_gap: "规则补充",
    uncertain: "历史不确定反馈",
  }[type] ?? "未反馈";
}

function matchesFeedbackFilter(feedback, filter) {
  if (filter === "all") return true;
  const type = normalizeFeedback(feedback).type;
  if (filter === "none") return !type;
  return type === filter;
}

function getFeedbackCounts(videos, feedbacks = {}) {
  const counts = {
    all: videos.length,
    filled: 0,
    false_positive: 0,
    false_negative: 0,
    rule_gap: 0,
    none: 0,
  };
  const activeTypes = new Set(["false_positive", "false_negative", "rule_gap"]);

  for (const video of videos) {
    const type = normalizeFeedback(
      video.feedback || feedbacks[video.video_id],
    ).type;
    if (!type) {
      counts.none += 1;
      continue;
    }
    if (activeTypes.has(type)) {
      counts.filled += 1;
      counts[type] += 1;
    }
  }

  return counts;
}

function summarizeFeedbackSamples(feedbacks, videos, auditResults) {
  return Object.entries(feedbacks || {})
    .map(([videoId, feedback]) => ({
      video: videos.find((item) => item.video_id === videoId) || null,
      auditResult: auditResults?.[videoId] || null,
      feedback: normalizeFeedback(feedback),
    }))
    .filter((sample) => sample.feedback.type);
}

function getManualReviewStatus(result, review) {
  return normalizeManualReview(review).status;
}

function getManualDecisionStatus(finalDecision) {
  return {
    pending_review: "pending",
    rejected: "rejected",
    ignored: "ignored",
  }[finalDecision?.final_status] ?? "";
}

function getManualReviewStatusLabel(status) {
  return {
    pending: "待人工审核",
    approved: "人工确认通过",
    rejected: "已退回修改",
    ignored: "已忽略",
  }[status] ?? "待人工审核";
}

function getManualReviewCounts(videos, manualReviews = {}) {
  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    ignored: 0,
  };

  for (const video of videos) {
    const finalDecision =
      video.finalDecision ||
      getFinalDecision(
        video,
        video.auditResult,
        video.manualReview || manualReviews[video.video_id],
      );
    const status = getManualDecisionStatus(finalDecision);
    if (status) counts[status] += 1;
  }

  return counts;
}

function getFinalAuditConclusion(result, manualReview, video = {}) {
  return getFinalDecision(video, result, manualReview).final_label;
}

function getFinalDecisionSourceLabel(source) {
  return {
    ai: "AI",
    manual: "人工",
    system: "系统",
  }[source] ?? "系统";
}

function getRunSummaryCounts(summary = {}) {
  const filters = summary.filter_counts ?? {};
  const finalCounts = summary.finalDecisionCounts ?? {};
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
    notAudited: Number(summary.notAudited ?? finalCounts.not_audited) || 0,
    publishable: Number(summary.publishable ?? finalCounts.publishable) || passed,
    pendingReview:
      Number(summary.pendingReview ?? finalCounts.pending_review) ||
      humanReview + legacyFix + legacyHigh,
    rejected: Number(summary.rejected ?? finalCounts.rejected) || 0,
    auditFailed: Number(summary.auditFailed ?? finalCounts.audit_failed) || failed,
    ignored: Number(summary.ignored ?? finalCounts.ignored) || 0,
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

function getFeedbackSampleApiError(response, payload) {
  if (response?.status === 401) {
    return "登录状态已失效，请重新登录。";
  }

  if (response?.status === 403) {
    return "无权限查看样本库。";
  }

  if (response?.status === 404) {
    return "质检样本库接口未部署，请联系管理员。";
  }

  if (response?.status >= 500) {
    return "样本库加载失败，请稍后重试。";
  }

  return payload?.message || "质检样本库读取失败。";
}

function getRuleApiError(response, payload) {
  if (response?.status === 401) return "登录状态已失效，请重新登录。";
  if (response?.status === 403) return "无权限操作规则库。";
  if (response?.status === 404) return "规则库接口未部署，请联系管理员。";
  if (response?.status >= 500) return "规则库加载失败，请稍后重试。";
  return payload?.message || "规则库操作失败，请稍后重试。";
}

function ruleToForm(rule = {}) {
  return {
    title: rule.title || "",
    category: rule.category || "价格活动",
    risk_level: rule.risk_level || "中",
    decision: rule.decision || "建议人工审核",
    keywords: listToEditableText(rule.keywords),
    description: rule.description || "",
    positive_examples: listToEditableText(rule.positive_examples),
    negative_examples: listToEditableText(rule.negative_examples),
    suggested_action: rule.suggested_action || "",
    enabled: rule.enabled !== false,
    source_sample_id: rule.source_sample_id || "",
  };
}

function formToRulePayload(form) {
  return {
    title: form.title,
    category: form.category,
    risk_level: form.risk_level,
    decision: form.decision,
    keywords: editableTextToList(form.keywords),
    description: form.description,
    positive_examples: editableTextToList(form.positive_examples),
    negative_examples: editableTextToList(form.negative_examples),
    suggested_action: form.suggested_action,
    enabled: Boolean(form.enabled),
    source_sample_id: form.source_sample_id,
  };
}

function listToEditableText(value) {
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function editableTextToList(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,，、]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
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
    pending: "\u5f85\u83b7\u53d6",
    loading: "\u83b7\u53d6\u4e2d",
    success: "\u5df2\u5b8c\u6210",
    partial_success: "\u90e8\u5206\u83b7\u53d6",
    pending_retry: "\u5f85\u91cd\u8bd5",
    failed: "\u5931\u8d25",
  }[value] ?? "\u5f85\u83b7\u53d6";
}

function getAccountFetchStatusText(account) {
  if (account.status === "success") {
    return account.count + " \u6761";
  }

  if (account.status === "partial_success") {
    return "\u90e8\u5206\u83b7\u53d6\uff1a" + (account.message || ("\u5df2\u83b7\u53d6 " + account.count + " \u6761"));
  }

  if (account.status === "pending_retry") {
    return "\u5f85\u91cd\u8bd5\uff1a" + (account.message || "\u672c\u6b21\u6682\u672a\u5904\u7406");
  }

  return "\u5931\u8d25\uff1a" + (account.message || "\u83b7\u53d6\u5931\u8d25");
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

function normalizeDateForApi(value) {
  const text = String(value ?? "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    return text;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);

  if (!slashMatch) {
    return "";
  }

  const month = Number(slashMatch[1]);
  const day = Number(slashMatch[2]);
  const year = Number(slashMatch[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }

  const normalized = new Date(Date.UTC(year, month - 1, day))
    .toISOString()
    .slice(0, 10);
  const [normalizedYear, normalizedMonth, normalizedDay] = normalized
    .split("-")
    .map(Number);

  return normalizedYear === year &&
    normalizedMonth === month &&
    normalizedDay === day
    ? normalized
    : "";
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
