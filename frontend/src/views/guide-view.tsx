'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Loader2 } from 'lucide-react';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * The in-app user guide: docs/UserGuide.md, copied to public/ at build time,
 * fetched and rendered here. Written as one markdown file so it can live in
 * the repo, print well, and render in the app from the same source.
 */
export function GuideView() {
  const { t } = useTranslation();
  const [md, setMd] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/user-guide.md')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => { if (!cancelled) setMd(text); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  // Headings become anchor targets, so the document's own table of contents
  // ("#1-what-this-app-is") scrolls inside the page.
  const slugify = useMemo(
    () => (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s/g, '-'),
    [],
  );

  useEffect(() => {
    if (!md) return;
    const headings = Array.from(document.querySelectorAll('#guide-body h2, #guide-body h3'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-48px 0px -70% 0px' },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [md]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-zinc-400" />
          {t('guide.title')}
        </h2>
        <p className="text-zinc-500 text-sm mt-0.5">{t('guide.intro')}</p>
      </div>

      {failed ? (
        <div className="rounded-lg border border-red-500/20 p-6 text-center text-red-400 text-sm">
          {t('guide.loadFailed')}
        </div>
      ) : md === null ? (
        <div className="flex items-center justify-center py-24 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div id="guide-body" className="guide-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => null,
              h2: ({ children }) => {
                const id = slugify(String(children));
                return (
                  <h2 id={id} className={`guide-h2 ${activeId === id ? 'text-zinc-100' : ''}`}>
                    {children}
                  </h2>
                );
              },
              h3: ({ children }) => {
                const id = slugify(String(children));
                return (
                  <h3 id={id} className="guide-h3">
                    {children}
                  </h3>
                );
              },
              h4: ({ children }) => <h4 className="guide-h3">{children}</h4>,
              table: ({ children }) => (
                <div className="overflow-x-auto my-4 rounded-lg border border-[var(--line-1)]">
                  <table className="w-full text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="text-left text-xs uppercase tracking-wider text-zinc-500 px-3 py-2 border-b border-[var(--line-1)] bg-[var(--fill-1)] whitespace-nowrap">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 border-b border-[var(--line-1)] align-top text-zinc-300">
                  {children}
                </td>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="underline underline-offset-2"
                  style={{ textDecorationColor: 'rgba(163,163,163,0.4)' }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {md}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
