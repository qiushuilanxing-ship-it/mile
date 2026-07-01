export class DouyinCrawlerError extends Error {
  constructor(message, code = "DOUYIN_CRAWLER_FAILED") {
    super(message);
    this.name = "DouyinCrawlerError";
    this.code = code;
  }
}

export class DouyinRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = "DouyinRangeError";
  }
}

export function normalizeSecUid(value) {
  return String(value ?? "")
    .replace(/\u200B/gu, "")
    .replace(/\uFEFF/gu, "")
    .trim();
}

export function normalizeAccountTaskRangeType(value) {
  const rangeType = String(value ?? "").trim();
  return !rangeType ||
    rangeType === "followDefault" ||
    rangeType === "跟随默认" ||
    rangeType === "default"
    ? "default"
    : rangeType;
}

export function resolveAccountTaskRangeInput(task, defaultRange) {
  const rangeType = normalizeAccountTaskRangeType(task?.rangeType);

  return rangeType === "default"
    ? {
        rangeType: defaultRange.rangeType,
        startDate: defaultRange.startDate,
        endDate: defaultRange.endDate,
      }
    : {
        rangeType,
        startDate: String(task?.startDate ?? "").trim(),
        endDate: String(task?.endDate ?? "").trim(),
      };
}

export function extractDouyinAwemeList(result) {
  if (!result || Number(result.code) !== 0) {
    throw new DouyinCrawlerError("Crawler 返回状态异常。");
  }

  const awemeList = result.data?.aweme_list;

  return Array.isArray(awemeList) ? awemeList : [];
}

export function extractDouyinVideos(result, options = {}) {
  return buildDouyinVideos(extractDouyinAwemeList(result), options);
}

export function buildDouyinVideos(
  awemeList,
  {
    startTime = 0,
    endTime = Number.POSITIVE_INFINITY,
    limit = Number.POSITIVE_INFINITY,
  } = {},
) {
  const uniqueAwemes = new Map();

  for (const aweme of Array.isArray(awemeList) ? awemeList : []) {
    const videoId = cleanText(aweme?.aweme_id ?? aweme?.video_id);

    if (videoId && !uniqueAwemes.has(videoId)) {
      uniqueAwemes.set(videoId, aweme);
    }
  }

  return [...uniqueAwemes.values()]
    .filter((aweme) => {
      const timestamp = getCreateTimeSeconds(aweme);
      return timestamp >= startTime && timestamp <= endTime;
    })
    .sort(
      (left, right) =>
        getCreateTimeSeconds(right) - getCreateTimeSeconds(left),
    )
    .slice(0, limit)
    .map((aweme, position) => {
      const videoId = cleanText(aweme?.aweme_id ?? aweme?.video_id);
      const createTime = getCreateTimeSeconds(aweme);

      return {
        index: position + 1,
        video_id: videoId,
        author_name: cleanText(
          aweme?.author?.nickname ?? aweme?.author_name,
        ),
        create_time: formatBeijingTime(createTime),
        create_time_ts: createTime,
        duration: normalizeDuration(aweme?.duration ?? aweme?.video?.duration),
        desc: cleanText(aweme?.desc),
        page_url: videoId ? `https://www.douyin.com/video/${videoId}` : "",
        cover_url: firstUrl(
          aweme?.cover_url,
          aweme?.video?.cover,
          aweme?.video?.origin_cover,
          aweme?.video?.dynamic_cover,
        ),
        play_url: firstUrl(
          aweme?.play_url,
          aweme?.video?.play_addr,
          aweme?.video?.play_addr_265,
          aweme?.video?.play_addr_h264,
        ),
      };
    });
}

export function resolveDouyinRange(
  { rangeType = "last7", startDate, endDate } = {},
  now = new Date(),
) {
  const normalizedRangeType = cleanText(rangeType) || "last7";
  const presetDays = {
    last3: 3,
    last7: 7,
    last30: 30,
  };
  let normalizedStartDate;
  let normalizedEndDate;

  if (normalizedRangeType === "custom") {
    normalizedStartDate = validateDateString(startDate, "startDate");
    normalizedEndDate = validateDateString(endDate, "endDate");
  } else if (Object.hasOwn(presetDays, normalizedRangeType)) {
    normalizedEndDate = formatBeijingDate(now);
    normalizedStartDate = addCalendarDays(
      normalizedEndDate,
      -presetDays[normalizedRangeType],
    );
  } else {
    throw new DouyinRangeError("date_parse_error: unsupported rangeType");
  }

  if (normalizedStartDate > normalizedEndDate) {
    throw new DouyinRangeError("date_parse_error: startDate is after endDate");
  }

  return {
    rangeType: normalizedRangeType,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    startTime: dateToBeijingTimestamp(normalizedStartDate),
    endTime: dateToBeijingTimestamp(normalizedEndDate, true),
  };
}

export function getCreateTimeSeconds(aweme) {
  const timestamp = Number(aweme?.create_time ?? aweme?.create_time_ts);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return Math.floor(
    timestamp >= 1_000_000_000_000 ? timestamp / 1000 : timestamp,
  );
}

export function formatBeijingTime(value) {
  const timestamp = normalizeTimestamp(value);

  if (!timestamp) {
    return "";
  }

  return new Date(timestamp + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function formatBeijingDate(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function addCalendarDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function validateDateString(value, label) {
  const dateString = parseDateInput(value);

  if (!dateString) {
    throw new DouyinRangeError(`date_parse_error: invalid ${label}`);
  }

  return dateString;
}

export function parseDateInput(value) {
  const dateString = cleanText(value);
  let year;
  let month;
  let day;

  if (/^\d{4}-\d{2}-\d{2}$/u.test(dateString)) {
    [year, month, day] = dateString.split("-").map(Number);
  } else {
    const slashMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u);

    if (!slashMatch) {
      return "";
    }

    month = Number(slashMatch[1]);
    day = Number(slashMatch[2]);
    year = Number(slashMatch[3]);
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1970 ||
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

  if (
    normalizedYear !== year ||
    normalizedMonth !== month ||
    normalizedDay !== day
  ) {
    return "";
  }

  return normalized;
}

function dateToBeijingTimestamp(dateString, endOfDay = false) {
  const [year, month, day] = dateString.split("-").map(Number);
  const beijingOffset = 8 * 60 * 60 * 1000;
  const dayStart = Date.UTC(year, month - 1, day) - beijingOffset;
  const timestamp = endOfDay ? dayStart + 24 * 60 * 60 * 1000 - 1 : dayStart;
  return Math.floor(timestamp / 1000);
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return timestamp >= 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

function normalizeDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function firstUrl(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    const urls = candidate?.url_list;

    if (Array.isArray(urls)) {
      const url = urls.find((item) => typeof item === "string" && item.trim());

      if (url) {
        return url.trim();
      }
    }
  }

  return "";
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}
