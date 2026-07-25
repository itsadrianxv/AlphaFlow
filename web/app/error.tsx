"use client";

import { useEffect } from "react";

import { ErrorPage } from "~/app/_components/error-page";

export default function ErrorBoundary(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { error, reset } = props;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorPage
      imageSrc="/illustrations/500.avif"
      imageAlt="500 服务器错误插画"
      statusCode="500"
      title="服务暂时不可用"
      description="服务器遇到问题，请重新加载页面后再试。"
      onRetry={reset}
    />
  );
}
