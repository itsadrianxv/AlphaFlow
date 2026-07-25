"use client";

import Image from "next/image";
import { useEffect } from "react";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { error, reset } = props;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: "#000000",
          color: "#f0f0f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main
          style={{
            boxSizing: "border-box",
            display: "grid",
            gap: "40px",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            alignItems: "center",
            maxWidth: "1120px",
            minHeight: "100vh",
            margin: "0 auto",
            padding: "48px 24px",
          }}
        >
          <Image
            src="/illustrations/500.avif"
            alt="500 服务器错误插画"
            width={720}
            height={540}
            priority
            style={{ height: "auto", maxWidth: "100%", width: "100%" }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: "72px", lineHeight: 1 }}>500</h1>
            <p style={{ fontSize: "20px", fontWeight: 600 }}>服务暂时不可用</p>
            <p style={{ color: "#a1a4a5", lineHeight: 1.75 }}>
              服务器遇到问题，请重新加载页面后再试。
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "20px",
                border: "1px solid #ffffff",
                borderRadius: "8px",
                padding: "10px 16px",
                background: "#ffffff",
                color: "#000000",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              重新加载
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
