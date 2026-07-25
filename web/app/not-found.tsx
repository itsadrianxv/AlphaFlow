import { ErrorPage } from "~/app/_components/error-page";

export default function NotFound() {
  return (
    <ErrorPage
      imageSrc="/illustrations/not-found.avif"
      imageAlt="404 页面不存在插画"
      statusCode="404"
      title="页面不存在"
      description="你访问的页面不存在，或已经被移除。"
    />
  );
}
