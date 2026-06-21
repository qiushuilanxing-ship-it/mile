import test from "node:test";
import assert from "node:assert/strict";
import {
  finalizeGenerationResult,
  GenerationEngineInputError,
  prepareGenerationRequest,
} from "./generation-engine.js";

test("combines prompt, multiple images, and video into one request record", () => {
  process.env.COZE_WORKFLOW_ID_ENGINE = "engine-workflow";

  const request = prepareGenerationRequest({
    prompt: "参考素材，为按摩仪生成一条短视频提示词",
    toolType: "product_script",
    assets: {
      imageFiles: [
        { fileId: "image-1", name: "product-front.png" },
        { fileId: "image-2", name: "product-side.png" },
      ],
      videoFileId: "video-1",
      videoFileName: "reference.mp4",
    },
  });

  assert.equal(request.workflowId, "engine-workflow");
  assert.equal(request.parameters.video, '{"file_id":"video-1"}');
  assert.equal(request.input.prompt, "参考素材，为按摩仪生成一条短视频提示词");
  assert.equal(request.input.tool_type, "product_script");
  assert.deepEqual(request.input.images, [
    { file_id: "image-1", name: "product-front.png" },
    { file_id: "image-2", name: "product-side.png" },
  ]);
});

test("requires a reference video for the verified workflow", () => {
  assert.throws(
    () =>
      prepareGenerationRequest({
        prompt: "拆解视频并替换成我的产品",
      }),
    /请上传参考视频/,
  );
});

test("prompt is the only required input", () => {
  assert.throws(
    () => prepareGenerationRequest({ prompt: " " }),
    GenerationEngineInputError,
  );
});

test("requires at least one reference image", () => {
  assert.throws(
    () =>
      prepareGenerationRequest({
        prompt: "拆解视频并替换成我的产品",
        assets: { videoFileId: "video-1" },
      }),
    /至少上传 1 张参考图片/,
  );
});

test("applies product replacement and multi-image consistency instructions", () => {
  const result = finalizeGenerationResult({
    result: "展示六款 vivo 手机，突出 vivo 的配色。",
    prompt: "将视频中的手机替换成三星的手机。",
    imageCount: 3,
  });

  assert.match(result, /目标替换产品：三星手机/);
  assert.match(result, /展示六款 三星手机/);
  assert.doesNotMatch(result, /vivo/i);
  assert.match(result, /已上传 3 张/);
});
