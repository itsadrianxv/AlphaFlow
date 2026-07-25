import { ErrorPage } from "~/app/_components/error-page";

export default function Forbidden() {
  return (
    <ErrorPage
      imageSrc="/illustrations/403.avif"
      imageAlt="403 无权访问插画"
      statusCode="403"
      title="无权访问"
      description="当前账号没有访问此页面的权限。"
    />
  );
}
