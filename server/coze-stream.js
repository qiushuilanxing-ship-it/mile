const RESULT_KEYS = ["data", "answer", "output", "result", "content"];

function tryParseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed || !["{", "["].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function parseSseEvents(payload) {
  const normalizedPayload = payload.replace(/\r\n/g, "\n");

  return normalizedPayload
    .split(/\n\n+/)
    .map((block) => {
      let type = "";
      const dataLines = [];

      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          type = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (!type || dataLines.length === 0) {
        return null;
      }

      return {
        type,
        data: tryParseJson(dataLines.join("\n")),
      };
    })
    .filter(Boolean);
}

export function extractPreferredResult(value, seen = new Set()) {
  const parsedValue = tryParseJson(value);

  if (typeof parsedValue === "string") {
    return parsedValue;
  }

  if (
    parsedValue === null ||
    parsedValue === undefined ||
    typeof parsedValue !== "object"
  ) {
    return parsedValue;
  }

  if (seen.has(parsedValue)) {
    return parsedValue;
  }

  seen.add(parsedValue);

  for (const key of RESULT_KEYS) {
    if (Object.hasOwn(parsedValue, key) && parsedValue[key] != null) {
      return extractPreferredResult(parsedValue[key], seen);
    }
  }

  return parsedValue;
}

function findCozeError(events) {
  return events.find((event) => {
    if (event.type.toLowerCase() === "error") {
      return true;
    }

    return (
      event.data &&
      typeof event.data === "object" &&
      Object.hasOwn(event.data, "code") &&
      Number(event.data.code) !== 0
    );
  });
}

function isFinalMessage(event) {
  if (
    event.type.toLowerCase() !== "message" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    return false;
  }

  return (
    event.data.node_is_finish === true ||
    event.data.node_type === "End" ||
    event.data.is_finish === true
  );
}

export function extractWorkflowResult(events) {
  const errorEvent = findCozeError(events);

  if (errorEvent) {
    const raw =
      errorEvent.data && typeof errorEvent.data === "object"
        ? errorEvent.data
        : { msg: String(errorEvent.data || "Coze 工作流执行失败") };
    const error = new Error("Coze 工作流执行失败，请稍后重试。");
    error.raw = raw;
    throw error;
  }

  const messages = events.filter(
    (event) => event.type.toLowerCase() === "message",
  );
  const finalMessages = messages.filter(isFinalMessage);
  const doneEvent = events.findLast(
    (event) => event.type.toLowerCase() === "done",
  );
  const finalMessage =
    finalMessages.at(-1) ??
    (doneEvent && messages.length === 1 ? messages[0] : null);

  if (!finalMessage) {
    const error = new Error("Coze 工作流未返回最终生成结果。");
    error.raw = {
      done: doneEvent?.data ?? null,
    };
    throw error;
  }

  const result = extractPreferredResult(finalMessage.data);

  if (result === null || result === undefined || result === "") {
    const error = new Error("Coze 工作流返回的生成结果为空。");
    error.code = "EMPTY_RESULT";
    error.raw = {
      final_message: finalMessage.data,
      done: doneEvent?.data ?? null,
    };
    throw error;
  }

  const usage = normalizeUsage(
    finalMessage.data && typeof finalMessage.data === "object"
      ? finalMessage.data.usage ??
          doneEvent?.data?.usage ??
          doneEvent?.data?.token_usage
      : doneEvent?.data?.usage ?? doneEvent?.data?.token_usage,
  );
  const debugUrl =
    doneEvent?.data && typeof doneEvent.data === "object"
      ? doneEvent.data.debug_url ?? doneEvent.data.debugUrl ?? null
      : null;

  return {
    result,
    usage,
    debugUrl,
    raw: {
      final_message: finalMessage.data,
      done: doneEvent?.data ?? null,
    },
  };
}

export function extractWorkflowResultWithFallback(payload) {
  const events = parseSseEvents(payload);

  try {
    return extractWorkflowResult(events);
  } catch (primaryError) {
    const errorCode = Number(
      primaryError.raw?.code ?? primaryError.raw?.error_code,
    );

    if (errorCode && errorCode !== 0) {
      throw primaryError;
    }

    const fallback = findFinalMessageFallback(payload, events);

    if (!fallback) {
      throw primaryError;
    }

    return fallback;
  }
}

function findFinalMessageFallback(payload, events) {
  const candidates = [];
  let parsedPayload = null;

  try {
    parsedPayload = JSON.parse(payload);
    candidates.push(
      parsedPayload.final_message,
      parsedPayload.finalMessage,
      parsedPayload.data,
      parsedPayload.answer,
      parsedPayload.output,
      parsedPayload.result,
    );
  } catch {
    // SSE payloads are normally not a single JSON document.
  }

  for (const event of events) {
    if (!event.data || typeof event.data !== "object") {
      continue;
    }

    candidates.push(event.data.final_message, event.data.finalMessage);

    if (
      event.data.node_is_finish === true ||
      event.data.node_type === "End" ||
      event.data.is_finish === true
    ) {
      candidates.push(event.data);
    }
  }

  const finalMessage = candidates.filter(Boolean).at(-1);

  if (!finalMessage) {
    return null;
  }

  const result = extractPreferredResult(finalMessage);

  if (isEmptyWorkflowResult(result)) {
    return null;
  }

  const doneEvent = events.findLast(
    (event) => event.type.toLowerCase() === "done",
  );

  return {
    result,
    usage: normalizeUsage(
      finalMessage && typeof finalMessage === "object"
        ? finalMessage.usage
        : parsedPayload?.usage ??
            parsedPayload?.data?.usage ??
            doneEvent?.data?.usage,
    ),
    debugUrl:
      doneEvent?.data && typeof doneEvent.data === "object"
        ? doneEvent.data.debug_url ?? doneEvent.data.debugUrl ?? null
        : parsedPayload?.debug_url ?? parsedPayload?.debugUrl ?? null,
    raw: {
      final_message: finalMessage,
      done: doneEvent?.data ?? null,
      fallback: true,
    },
  };
}

export function normalizeUsage(value) {
  if (!value || typeof value !== "object") {
    return { token_count: 0 };
  }

  const direct = Number(
    value.token_count ??
      value.total_tokens ??
      value.total_token_count ??
      value.total_tokens_count,
  );
  const inputTokens = Number(
    value.input_tokens ?? value.input_token_count ?? value.prompt_tokens,
  );
  const outputTokens = Number(
    value.output_tokens ?? value.output_token_count ?? value.completion_tokens,
  );
  const tokenCount = Number.isFinite(direct)
    ? direct
    : (Number.isFinite(inputTokens) ? inputTokens : 0) +
      (Number.isFinite(outputTokens) ? outputTokens : 0);

  return {
    ...value,
    token_count: Math.max(0, tokenCount || 0),
  };
}

export function isEmptyWorkflowResult(result) {
  if (result === null || result === undefined) {
    return true;
  }

  if (typeof result === "string") {
    return result.trim() === "";
  }

  if (Array.isArray(result)) {
    return result.length === 0;
  }

  if (typeof result === "object") {
    return Object.keys(result).length === 0;
  }

  return false;
}
