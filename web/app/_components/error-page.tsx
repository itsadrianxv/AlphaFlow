import Image from "next/image";
import Link from "next/link";

type ErrorPageProps = {
  imageSrc: string;
  imageAlt: string;
  statusCode: string;
  title: string;
  description: string;
  onRetry?: () => void;
};

export function ErrorPage(props: ErrorPageProps) {
  const { imageSrc, imageAlt, statusCode, title, description, onRetry } = props;

  return (
    <main className="app-shell flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
      <div className="grid w-full max-w-[1120px] items-center gap-10 md:grid-cols-[minmax(0,1fr)_360px] md:gap-16">
        <div className="flex items-center justify-center">
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={720}
            height={540}
            priority
            sizes="(min-width: 768px) 58vw, 100vw"
            className="h-auto w-full max-w-[680px] object-contain"
          />
        </div>

        <div>
          <h1 className="app-display text-7xl leading-none text-[var(--app-text-strong)] sm:text-8xl">
            {statusCode}
          </h1>
          <p className="mt-5 text-xl font-medium text-[var(--app-text-strong)]">
            {title}
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
            {description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className="app-button app-button-primary">
              返回首页
            </Link>
            {onRetry ? (
              <button type="button" className="app-button" onClick={onRetry}>
                重新加载
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
