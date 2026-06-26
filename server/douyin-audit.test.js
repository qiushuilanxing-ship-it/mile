import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDouyinVideos,
  DouyinCrawlerError,
  DouyinRangeError,
  extractDouyinVideos,
  formatBeijingTime,
  normalizeAccountTaskRangeType,
  normalizeSecUid,
  resolveAccountTaskRangeInput,
  resolveDouyinRange,
} from "./douyin-audit.js";

test("sorts, deduplicates, filters, and maps videos", () => {
  const awemeList = Array.from({ length: 12 }, (_, index) => ({
    aweme_id: `video-${index + 1}`,
    create_time: 1_700_000_000 + index,
    desc: `description-${index + 1}`,
    duration: 1000 + index,
    author: { nickname: "测试账号" },
    video: {
      cover: { url_list: [`https://cover/${index + 1}.jpg`] },
      play_addr: { url_list: [`https://play/${index + 1}.mp4`] },
    },
  }));
  awemeList.push({ ...awemeList[11] });

  const videos = buildDouyinVideos(awemeList.reverse(), {
    startTime: 1_700_000_003,
    endTime: 1_700_000_011,
    limit: 5,
  });

  assert.equal(videos.length, 5);
  assert.equal(videos[0].index, 1);
  assert.equal(videos[0].video_id, "video-12");
  assert.equal(videos[0].create_time_ts, 1_700_000_011);
  assert.equal(videos[0].page_url, "https://www.douyin.com/video/video-12");
  assert.equal(videos[0].cover_url, "https://cover/12.jpg");
  assert.equal(videos[0].play_url, "https://play/12.mp4");
  assert.equal(videos[4].video_id, "video-8");
});

test("formats create_time as Beijing time", () => {
  assert.equal(formatBeijingTime(0), "");
  assert.equal(formatBeijingTime(1_700_000_000), "2023-11-15 06:13:20");
});

test("returns an empty list when crawler has no works", () => {
  assert.deepEqual(
    extractDouyinVideos({ code: 0, data: { aweme_list: [] } }),
    [],
  );
});

test("rejects a non-zero crawler result code", () => {
  assert.throws(
    () => extractDouyinVideos({ code: 1, data: {} }),
    DouyinCrawlerError,
  );
});

test("resolves preset ranges using Beijing calendar dates", () => {
  assert.deepEqual(
    resolveDouyinRange(
      { rangeType: "last7" },
      new Date("2026-06-24T04:00:00.000Z"),
    ),
    {
      rangeType: "last7",
      startDate: "2026-06-17",
      endDate: "2026-06-24",
      startTime: 1_781_625_600,
      endTime: 1_782_316_799,
    },
  );
});

test("validates custom date ranges", () => {
  const range = resolveDouyinRange({
    rangeType: "custom",
    startDate: "2026-06-01",
    endDate: "2026-06-24",
  });

  assert.equal(range.startDate, "2026-06-01");
  assert.equal(range.endDate, "2026-06-24");
  assert.throws(
    () =>
      resolveDouyinRange({
        rangeType: "custom",
        startDate: "2026-06-25",
        endDate: "2026-06-24",
      }),
    DouyinRangeError,
  );
});

test("normalizes invisible characters from secUid", () => {
  assert.equal(
    normalizeSecUid("\uFEFF\u200B MS4wLjABAAAA-test \u200B"),
    "MS4wLjABAAAA-test",
  );
});

test("resolves follow-default account task ranges before date filtering", () => {
  const defaultRange = {
    rangeType: "last7",
    startDate: "2026-06-18",
    endDate: "2026-06-25",
  };

  for (const value of ["followDefault", "跟随默认", "", undefined, "default"]) {
    assert.equal(normalizeAccountTaskRangeType(value), "default");
    assert.deepEqual(
      resolveAccountTaskRangeInput({ rangeType: value }, defaultRange),
      defaultRange,
    );
  }

  assert.deepEqual(
    resolveAccountTaskRangeInput(
      {
        rangeType: "custom",
        startDate: "2026-06-01",
        endDate: "2026-06-04",
      },
      defaultRange,
    ),
    {
      rangeType: "custom",
      startDate: "2026-06-01",
      endDate: "2026-06-04",
    },
  );
});
