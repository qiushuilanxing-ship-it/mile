import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { tools } from "./tool-config.js";

const quickScenes = [
  { label: "测评对比", toolId: "video_reverse", icon: "PK" },
];

export default function HomePage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [selectedToolId, setSelectedToolId] = useState("video_reverse");

  function startCreation(toolId = selectedToolId) {
    const tool = tools.find((item) => item.id === toolId);

    if (!tool || tool.reserved) {
      return;
    }

    navigate(`/tools/${tool.id}`, {
      state: { initialPrompt: prompt.trim() },
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    startCreation();
  }

  return (
    <div className="home-page">
      <section className="home-hero">
        <h1>欢迎使用 AI 内容引擎</h1>
        <p className="home-slogan" aria-label="让好内容快人一步">
          {"让好内容快人一步".split("").map((character, index) => (
            <span key={`${character}-${index}`}>{character}</span>
          ))}
        </p>

        <form className="creation-composer" onSubmit={handleSubmit}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="输入你想生成的内容，例如：参考一条爆款视频，为我们的按摩仪生成短视频脚本……"
            rows="4"
            maxLength="20000"
          />
          <div className="composer-toolbar">
            <div className="composer-actions">
              <button type="button" onClick={() => startCreation()}>
                <span>▣</span> 参考视频
              </button>
              <button type="button" onClick={() => startCreation()}>
                <span>◇</span> 参考图片
              </button>
              <label>
                <span>✦</span>
                <select
                  value={selectedToolId}
                  onChange={(event) => setSelectedToolId(event.target.value)}
                  aria-label="选择 AI 工具"
                >
                  {tools
                    .filter((tool) => !tool.reserved)
                    .map((tool) => (
                      <option key={tool.id} value={tool.id}>
                        {tool.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <button className="composer-submit" type="submit" aria-label="开始创作">
              ↑
            </button>
          </div>
        </form>

        <div className="scene-chips" aria-label="快捷创作场景">
          {quickScenes.map((scene) => (
            <button
              key={scene.label}
              type="button"
              onClick={() => {
                setSelectedToolId(scene.toolId);
                startCreation(scene.toolId);
              }}
            >
              <span>{scene.icon}</span>
              {scene.label}
            </button>
          ))}
        </div>
      </section>

      <section className="popular-tools">
        <header>
          <h2>热门功能</h2>
          <Link to="/history">查看历史记录 →</Link>
        </header>

        <div className="popular-tool-grid">
          {tools.map((tool) =>
            tool.reserved ? (
              <article
                className={`popular-tool-card reserved accent-${tool.accent}`}
                key={tool.id}
              >
                <ToolCardContent tool={tool} />
              </article>
            ) : (
              <Link
                className={`popular-tool-card accent-${tool.accent}`}
                to={`/tools/${tool.id}`}
                key={tool.id}
              >
                <ToolCardContent tool={tool} />
              </Link>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

function ToolCardContent({ tool }) {
  return (
    <>
      <div className="tool-card-title">
        <span>{tool.index}</span>
        <div>
          <strong>{tool.name}</strong>
          <small>{tool.shortDescription}</small>
        </div>
      </div>
      <div className="tool-card-preview">
        <img src={tool.cover} alt={`${tool.name}封面`} loading="lazy" />
        <strong>{tool.previewLabel}</strong>
      </div>
      <div className="tool-card-footer">
        <span>{tool.reserved ? "COMING SOON" : "立即使用"}</span>
        <strong>{tool.reserved ? "—" : "↗"}</strong>
      </div>
    </>
  );
}
