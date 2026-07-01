import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptDirectory, "..");
const envPath = path.join(serverDirectory, ".env");
const weakPasswords = new Set([
  "123456",
  "12345678",
  "password",
  "admin",
  "admin123",
  "qwerty123",
]);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const adminUsername = String(process.env.ADMIN_USERNAME || "admin").trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const adminName = String(process.env.ADMIN_NAME || adminUsername).trim();

if (!adminUsername) {
  console.error("[auth reset] ADMIN_USERNAME is empty.");
  process.exit(1);
}

if (!isStrongPassword(adminPassword, adminUsername)) {
  console.error(
    "[auth reset] ADMIN_PASSWORD must be at least 8 characters and cannot be a weak/default password.",
  );
  process.exit(1);
}

const { authenticateUser, upsertUser, closeDatabase } = await import(
  "../database.js"
);

try {
  const user = upsertUser({
    username: adminUsername,
    password: adminPassword,
    name: adminName,
    role: "admin",
    department: "management",
  });
  const verified = authenticateUser(adminUsername, adminPassword);

  if (!verified) {
    console.error("[auth reset] Admin password was written but verification failed.");
    process.exitCode = 1;
  } else {
    console.log("[auth reset] Admin account is ready.");
    console.log("[auth reset] username:", user.username);
    console.log("[auth reset] name:", user.name);
    console.log("[auth reset] role:", user.role);
  }
} finally {
  closeDatabase();
}

function isStrongPassword(password, username) {
  const value = String(password || "");
  const normalized = value.toLowerCase();

  return (
    value.length >= 8 &&
    normalized !== String(username || "").toLowerCase() &&
    !weakPasswords.has(normalized)
  );
}
