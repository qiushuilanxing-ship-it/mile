export function logInfo(event, context = {}) {
  writeLog("info", event, context);
}

export function logError(event, error, context = {}) {
  writeLog("error", event, {
    ...context,
    error: serializeError(error),
  });
}

function writeLog(level, event, context) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  const output = JSON.stringify(payload);

  if (level === "error") {
    console.error(output);
  } else {
    console.log(output);
  }
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    raw: error.raw,
  };
}
