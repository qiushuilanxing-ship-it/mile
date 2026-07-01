import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptDirectory, "..");
const envPath = path.join(serverDirectory, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const databasePath =
  process.env.SQLITE_PATH || path.join(serverDirectory, "data.sqlite");
const adminUsername = String(process.env.ADMIN_USERNAME || "admin").trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const adminName = String(process.env.ADMIN_NAME || adminUsername).trim();

const { authenticateUser, listUsers, closeDatabase } = await import(
  "../database.js"
);

try {
  const admin = authenticateUser(adminUsername, adminPassword);
  const users = listUsers();

  console.log("[auth check] server directory:", serverDirectory);
  console.log("[auth check] .env path:", envPath);
  console.log("[auth check] .env exists:", fs.existsSync(envPath));
  console.log("[auth check] sqlite path:", databasePath);
  console.log("[auth check] sqlite exists:", fs.existsSync(databasePath));
  console.log("[auth check] ADMIN_USERNAME:", adminUsername || "(empty)");
  console.log("[auth check] ADMIN_NAME:", adminName || "(empty)");
  console.log(
    "[auth check] ADMIN_PASSWORD configured:",
    adminPassword ? "yes" : "no",
  );
  console.log(
    "[auth check] ADMIN_PASSWORD length:",
    adminPassword ? adminPassword.length : 0,
  );
  console.log("[auth check] env admin login ok:", admin ? "yes" : "no");
  console.log("[auth check] user count:", users.length);
  console.log(
    "[auth check] users:",
    users.map((user) => `${user.username}(${user.role})`).join(", ") || "(none)",
  );

  if (!adminPassword) {
    process.exitCode = 1;
    console.error("[auth check] ADMIN_PASSWORD is empty. Fill server/.env first.");
  } else if (!admin) {
    process.exitCode = 1;
    console.error(
      "[auth check] The env admin cannot log in. Run: npm run auth:reset-admin",
    );
  }
} finally {
  closeDatabase();
}
