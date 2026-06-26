import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { parseAccountProfilesWorkbook } from "./account-profiles.js";

function createWorkbook(rows, sheetName = "直播间名称") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    sheetName,
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("recognizes account profile fields by header instead of fixed column", () => {
  const buffer = createWorkbook([
    ["前端名称", "运营/编剪", "门牌", "账号主页UID", "ERP名称", "经营状态"],
    ["小米电视机旗舰店", "王少迪/王忠鑫", "D252", "uid-1", "ERP店铺", "正常"],
  ]);
  const result = parseAccountProfilesWorkbook(buffer);

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].secUid, "uid-1");
  assert.equal(result.accounts[0].frontend_name, "小米电视机旗舰店");
  assert.equal(result.accounts[0].operator, "王少迪/王忠鑫");
  assert.equal(result.accounts[0].source_row, 2);
});

test("counts missing and duplicate UIDs and keeps the more complete row", () => {
  const buffer = createWorkbook([
    ["账号主页UID", "前端名称", "ERP名称", "运营/编剪"],
    ["uid-1", "店铺A", "", ""],
    ["", "缺少UID", "", ""],
    ["uid-1", "店铺A", "ERP A", "运营A"],
  ]);
  const result = parseAccountProfilesWorkbook(buffer);

  assert.equal(result.valid_uid_count, 1);
  assert.equal(result.missing_uid_count, 1);
  assert.equal(result.duplicate_uid_count, 1);
  assert.equal(result.accounts[0].erp_name, "ERP A");
  assert.equal(result.accounts[0].operator, "运营A");
});

test("uses the first sheet and an explicitly supplied fallback UID column", () => {
  const buffer = createWorkbook([
    ["前端名称", "备用字段"],
    ["店铺B", "uid-2"],
  ], "账号清单");
  const result = parseAccountProfilesWorkbook(buffer, { uidColumn: "B" });

  assert.equal(result.sheet_name, "账号清单");
  assert.equal(result.accounts[0].secUid, "uid-2");
});
