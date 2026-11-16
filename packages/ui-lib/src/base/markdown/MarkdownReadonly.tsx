import { memo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import { cn } from '../../shadcn';

interface IMarkdownReadonlyProps {
  value: string;
  className?: string;
  /** For generated answers: use separately validated source cards for navigation. */
  disableLinksAndImages?: boolean;
}

const textOnlyLinks: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: () => null,
};

/**
 * Lightweight markdown renderer for readonly display.
 * Uses react-markdown instead of a full milkdown editor instance for better performance.
 *
 * Safe by default: react-markdown does NOT render raw HTML unless `rehype-raw`
 * is plugged in, so embedded `<script>` / `<img onerror>` etc. in the source
 * are escaped to text — no DOM injection risk.
 */
export const MarkdownReadonly = memo(
  ({ value, className, disableLinksAndImages }: IMarkdownReadonlyProps) => {
    if (!value) return null;

    return (
      <div className={cn('milkdown-editor-wrap w-full text-sm', className)}>
        <div className="milkdown-readonly-preview">
          <Markdown
            remarkPlugins={[remarkGfm, remarkCjkFriendly]}
            components={disableLinksAndImages ? textOnlyLinks : undefined}
          >
            {value}
          </Markdown>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.className === next.className &&
    prev.disableLinksAndImages === next.disableLinksAndImages
);

MarkdownReadonly.displayName = 'MarkdownReadonly';
