"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import Scene2D, { SceneLegend } from "./Scene2D";
import { supports3D } from "../lib/viz";
import type { SceneData, SceneNode } from "../lib/scene-data";

/**
 * Hosts the data galaxy.
 *
 * The 3D scene is loaded only when the device can actually run it: three.js
 * and its helpers are a large download, so the import is dynamic and never
 * server-rendered, and a phone that reports too few cores gets the 2D view
 * without paying for the bundle at all.
 */

const Scene3D = dynamic(() => import("./Scene3D"), {
  ssr: false,
  loading: () => <div className="scene-root scene-loading">Loading 3D scene…</div>,
});

type Props = {
  data: SceneData;
  onSelect: (node: SceneNode) => void;
};

export default function SceneStage({ data, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [capable, setCapable] = useState<boolean | null>(null);
  const [use3D, setUse3D] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // Remounting the scene is the simplest way to return the camera home.
  const [sceneKey, setSceneKey] = useState(0);

  useEffect(() => {
    const ok = supports3D();
    setCapable(ok);
    setUse3D(ok);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!container.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current.requestFullscreen();
    } catch {
      // Safari on iOS refuses fullscreen on non-video elements; the button
      // simply does nothing there rather than throwing at the user.
    }
  }, []);

  const empty =
    !data.keywords.length && !data.prompts.length && !data.citations.length && !data.backlinks.length;

  return (
    <section className="stage" ref={container} aria-label="Data galaxy">
      <div className="stage-toolbar">
        <div className="seg" role="group" aria-label="Rendering mode">
          <button
            type="button"
            className={use3D ? "seg-on" : "seg-off"}
            aria-pressed={use3D}
            onClick={() => setUse3D(true)}
            disabled={!capable}
            title={capable ? undefined : "This device cannot run the 3D scene"}
          >
            3D
          </button>
          <button
            type="button"
            className={!use3D ? "seg-on" : "seg-off"}
            aria-pressed={!use3D}
            onClick={() => setUse3D(false)}
          >
            2D
          </button>
        </div>

        <div className="row">
          {use3D && (
            <>
              <button type="button" className="secondary" onClick={() => setAutoRotate((r) => !r)} aria-pressed={autoRotate}>
                {autoRotate ? "Pause spin" : "Auto-rotate"}
              </button>
              <button type="button" className="secondary" onClick={() => setSceneKey((k) => k + 1)}>
                Reset view
              </button>
            </>
          )}
          <button type="button" className="secondary" onClick={toggleFullscreen}>
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>

      {empty ? (
        <div className="scene-root scene-loading">
          <div style={{ textAlign: "center", maxWidth: 420 }}>
            <p style={{ marginTop: 0 }}>Nothing to plot yet.</p>
            <p className="meta">
              Run a sync or an LLM probe and this fills with your keywords, prompts, citations and
              backlinks.
            </p>
          </div>
        </div>
      ) : use3D && capable ? (
        <Scene3D key={sceneKey} data={data} onSelect={onSelect} autoRotate={autoRotate} />
      ) : (
        <Scene2D data={data} onSelect={onSelect} />
      )}

      {capable === false && (
        <p className="hint stage-note">
          3D is unavailable on this device — showing the 2D view. Everything below is identical.
        </p>
      )}

      <SceneLegend />
      <p className="hint stage-note">
        {use3D
          ? "Drag to orbit · pinch or scroll to zoom · two fingers to pan · hover or tap a node for detail."
          : "Hover or focus a mark for detail. Tab moves between marks; Enter opens the row below."}
      </p>
    </section>
  );
}
