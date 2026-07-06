/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in tests. */
import React, { type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/app/_components/ui";

export type MarkdownContentProps = {
  content: string;
  className?: string;
  compact?: boolean;
};

function textClassName(compact?: boolean) {
  return compact ? "text-sm leading-6" : "text-sm leading-7";
}

function MarkdownParagraph(
  props: ComponentPropsWithoutRef<"p"> & {
    compact?: boolean;
  },
) {
  const { compact, className, ...rest } = props;
  return (
    <p
      className={cn(
        textClassName(compact),
        "text-[var(--app-text-muted)]",
        className,
      )}
      {...rest}
    />
  );
}

export function MarkdownContent(props: MarkdownContentProps) {
  const content = props.content.trim();

  if (content.length === 0) {
    return null;
  }

  const compact = props.compact ?? false;
  const proseClassName = textClassName(compact);

  return (
    <div
      className={cn(
        "markdown-content min-w-0 text-[var(--app-text)]",
        "[&_a]:text-[var(--app-accent-strong)] [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--app-border-strong)] [&_blockquote]:pl-4",
        "[&_ol]:list-decimal [&_ol]:pl-5",
        "[&_ul]:list-disc [&_ul]:pl-5",
        props.className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, className, ...rest }) => (
            <h1
              className={cn(
                "font-[family-name:var(--font-heading)] text-2xl leading-tight text-[var(--app-text-strong)]",
                className,
              )}
              {...rest}
            />
          ),
          h2: ({ node: _node, className, ...rest }) => (
            <h2
              className={cn(
                "font-[family-name:var(--font-heading)] text-xl leading-tight text-[var(--app-text-strong)]",
                className,
              )}
              {...rest}
            />
          ),
          h3: ({ node: _node, className, ...rest }) => (
            <h3
              className={cn(
                "font-[family-name:var(--font-heading)] text-lg leading-tight text-[var(--app-text-strong)]",
                className,
              )}
              {...rest}
            />
          ),
          h4: ({ node: _node, className, ...rest }) => (
            <h4
              className={cn(
                "font-[family-name:var(--font-heading)] text-base leading-tight text-[var(--app-text-strong)]",
                className,
              )}
              {...rest}
            />
          ),
          p: ({ node: _node, ...rest }) => (
            <MarkdownParagraph compact={compact} {...rest} />
          ),
          ul: ({ node: _node, className, ...rest }) => (
            <ul
              className={cn(
                proseClassName,
                "grid gap-1.5 text-[var(--app-text-muted)]",
                className,
              )}
              {...rest}
            />
          ),
          ol: ({ node: _node, className, ...rest }) => (
            <ol
              className={cn(
                proseClassName,
                "grid gap-1.5 text-[var(--app-text-muted)]",
                className,
              )}
              {...rest}
            />
          ),
          li: ({ node: _node, className, ...rest }) => (
            <li
              className={cn("text-[var(--app-text-muted)]", className)}
              {...rest}
            />
          ),
          strong: ({ node: _node, className, ...rest }) => (
            <strong
              className={cn("font-semibold text-[var(--app-text)]", className)}
              {...rest}
            />
          ),
          blockquote: ({ node: _node, className, ...rest }) => (
            <blockquote
              className={cn(
                proseClassName,
                "text-[var(--app-text-muted)]",
                className,
              )}
              {...rest}
            />
          ),
          a: ({ node: _node, className, href, ...rest }) => (
            <a
              className={cn("break-all", className)}
              href={href}
              rel={href?.startsWith("http") ? "noreferrer" : undefined}
              target={href?.startsWith("http") ? "_blank" : undefined}
              {...rest}
            />
          ),
          pre: ({ node: _node, className, ...rest }) => (
            <pre
              className={cn(
                "overflow-x-auto rounded-[12px] border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3 text-xs leading-6 text-[var(--app-text)]",
                className,
              )}
              {...rest}
            />
          ),
          code: ({ node: _node, className, children, ...rest }) => {
            const text = Array.isArray(children)
              ? children.map((item) => String(item)).join("")
              : String(children);
            const isInline = !className && !text.includes("\n");

            if (isInline) {
              return (
                <code
                  className={cn(
                    "rounded-[6px] bg-[var(--app-code-bg)] px-1.5 py-0.5 text-[0.95em] text-[var(--app-accent-strong)]",
                    className,
                  )}
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            return (
              <code
                className={cn("text-[var(--app-accent-strong)]", className)}
                {...rest}
              >
                {children}
              </code>
            );
          },
          table: ({ node: _node, className, ...rest }) => (
            <table
              className={cn(
                "min-w-full border-collapse text-left text-sm text-[var(--app-text-muted)]",
                className,
              )}
              {...rest}
            />
          ),
          thead: ({ node: _node, className, ...rest }) => (
            <thead
              className={cn("border-b border-[var(--app-border)]", className)}
              {...rest}
            />
          ),
          tbody: ({ node: _node, className, ...rest }) => (
            <tbody
              className={cn(
                "[&_tr:not(:last-child)]:border-b [&_tr:not(:last-child)]:border-[var(--app-border-soft)]",
                className,
              )}
              {...rest}
            />
          ),
          th: ({ node: _node, className, ...rest }) => (
            <th
              className={cn(
                "px-3 py-2 font-medium text-[var(--app-text-strong)]",
                className,
              )}
              {...rest}
            />
          ),
          td: ({ node: _node, className, ...rest }) => (
            <td className={cn("px-3 py-2 align-top", className)} {...rest} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
