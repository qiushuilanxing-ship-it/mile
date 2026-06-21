const activeUsers = new Map();

export function acquireUserRequest(userId, requestId) {
  const key = String(userId);
  const active = activeUsers.get(key);

  if (active) {
    return {
      acquired: false,
      activeRequestId: active.requestId,
    };
  }

  activeUsers.set(key, {
    requestId,
    startedAt: Date.now(),
  });

  let released = false;

  return {
    acquired: true,
    release() {
      if (released) {
        return;
      }

      released = true;
      const current = activeUsers.get(key);

      if (current?.requestId === requestId) {
        activeUsers.delete(key);
      }
    },
  };
}

export function getActiveRequest(userId) {
  return activeUsers.get(String(userId)) ?? null;
}

export function clearRequestGuards() {
  activeUsers.clear();
}
