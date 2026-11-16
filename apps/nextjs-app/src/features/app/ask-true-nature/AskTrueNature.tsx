import { HttpAgent } from '@ag-ui/client';
import type { Message } from '@ag-ui/client';
import { MarkdownReadonly } from '@teable/ui-lib/base';
import { Badge, Button, Card, CardContent, Textarea } from '@teable/ui-lib/shadcn';
import { ArrowUp, ExternalLink, MessageSquare, Plus, Radio, Disc3, Square } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { RADIO_BASE } from '../radio/radio-data';
import styles from './ask.module.css';

interface Source {
  id: string;
  title: string;
  href: string;
  detail: string;
}
const endpoint = `/api/base/${RADIO_BASE}/ask-true-nature`;
const prompts = [
  'Which tracks have the most radio plays in our imported data?',
  'Where and when were our tracks played in Denmark?',
  'What is missing for our next release?',
  'Which releases are missing audio or ISRCs?',
];
function safeSources(value: unknown): Source[] {
  const sources = (value as { sources?: unknown })?.sources;
  if (!Array.isArray(sources)) return [];
  return sources
    .filter(
      (s): s is Source =>
        s &&
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        typeof s.detail === 'string' &&
        typeof s.href === 'string' &&
        (s.href.startsWith(`/base/${RADIO_BASE}/`) ||
          s.href.startsWith('https://suite.truenature.online/releases/'))
    )
    .slice(0, 30);
}
export function AskTrueNature() {
  const agent = useRef<HttpAgent | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState<boolean | null>(null);
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    const a = new HttpAgent({ url: endpoint, threadId: crypto.randomUUID() });
    agent.current = a;
    const subscription = a.subscribe({
      onMessagesChanged: ({ messages }) => setMessages([...messages]),
      onStateChanged: ({ state }) => setSources(safeSources(state)),
      onToolCallStartEvent: ({ event }) =>
        setStatus(
          event.toolCallName === 'radio_plays'
            ? 'Checking imported radio plays…'
            : 'Checking live release readiness…'
        ),
      onTextMessageContentEvent: () => setStatus('Writing answer…'),
      onRunErrorEvent: ({ event }) => setError(event.message),
    });
    fetch(`${endpoint}/status`, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setReady(data.ready === true);
        if (!data.ready) setError(data.message || 'The Codex connection needs attention.');
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setReady(false);
          setError('Could not check the assistant connection. Please reload.');
        }
      });
    return () => {
      abort.abort();
      a.abortRun();
      subscription.unsubscribe();
      agent.current = undefined;
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages, busy]);
  const ask = async (text: string) => {
    const a = agent.current;
    if (!a || running.current || !text.trim() || !ready) return;
    running.current = true;
    stoppedRef.current = false;
    setBusy(true);
    setStopped(false);
    setError('');
    setSources([]);
    setQuestion('');
    setStatus('Reading your question…');
    a.addMessage({ id: crypto.randomUUID(), role: 'user', content: text.trim() });
    try {
      await a.runAgent({ runId: crypto.randomUUID() });
    } catch {
      if (!stoppedRef.current)
        setError('The answer could not be completed. Please retry. Your data has not changed.');
    } finally {
      running.current = false;
      setBusy(false);
      setStatus('');
    }
  };
  const clear = () => {
    if (running.current || !agent.current) return;
    agent.current.setMessages([]);
    agent.current.setState({});
    agent.current.threadId = crypto.randomUUID();
    setSources([]);
    setError('');
    setStopped(false);
    setQuestion('');
    input.current?.focus();
  };
  const visible = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim()
  );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <MessageSquare size={16} className="shrink-0" /> Ask True Nature
        </h1>
        <Button variant="ghost" size="sm" disabled={busy || !messages.length} onClick={clear}>
          <Plus size={15} /> New chat
        </Button>
      </header>
      <div className={styles.layout}>
        <div className={styles.conversation} ref={conversation}>
          <div className={styles.scroll}>
            {!visible.length && (
              <div className={styles.welcome}>
                <Badge variant="secondary">Radio & releases</Badge>
                <h2>What would you like to know?</h2>
                <p>
                  Explore where your music is being played and what needs attention before release.
                </p>
                <div className={styles.prompts}>
                  {prompts.map((prompt, i) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      className={styles.prompt}
                      disabled={busy || !ready}
                      onClick={() => void ask(prompt)}
                    >
                      {i < 2 ? <Radio size={16} /> : <Disc3 size={16} />}
                      <span>{prompt}</span>
                    </Button>
                  ))}
                </div>
                <p className={styles.note}>
                  Radio uses an imported Songstats snapshot. Release readiness is checked live in
                  Label Suite. Each answer links back to its sources.
                </p>
              </div>
            )}
            <div className={styles.messages}>
              {visible.map((m) => (
                <article
                  className={m.role === 'user' ? styles.user : styles.answer}
                  key={m.id}
                  aria-label={m.role === 'user' ? 'Your question' : 'Assistant answer'}
                >
                  <p className={styles.author}>{m.role === 'user' ? 'You' : 'Ask True Nature'}</p>
                  <div className={styles.text}>
                    {m.role === 'assistant' ? (
                      <MarkdownReadonly
                        value={m.content as string}
                        disableLinksAndImages
                        className={styles.markdown}
                      />
                    ) : (
                      (m.content as string)
                    )}
                  </div>
                </article>
              ))}
            </div>
            {busy && (
              <p className={styles.progress} role="status">
                {status}
              </p>
            )}
            {stopped && (
              <p className={styles.progress} role="status">
                Stopped. Any partial answer above may be incomplete.
              </p>
            )}
            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}
            <div ref={bottom} />
          </div>
          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <div className={styles.inputRow}>
              <Textarea
                ref={input}
                aria-label="Ask about radio plays or release readiness"
                placeholder={
                  ready === null ? 'Connecting…' : 'Ask about radio plays or release readiness…'
                }
                value={question}
                maxLength={4000}
                disabled={ready !== true}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    window.matchMedia('(min-width: 769px)').matches
                  ) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
                rows={2}
              />
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Stop answer"
                  onClick={() => {
                    stoppedRef.current = true;
                    setStopped(true);
                    agent.current?.abortRun();
                  }}
                >
                  <Square size={16} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send question"
                  disabled={!ready || !question.trim()}
                >
                  <ArrowUp size={18} />
                </Button>
              )}
            </div>
            {sources.length > 0 && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className={styles.mobileSources}
                onClick={() =>
                  sourcePanel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                }
              >
                View {sources.length} sources
              </Button>
            )}
            <p className={styles.note}>
              Read-only · Check source records before acting · Chat clears when you leave this page
            </p>
          </form>
        </div>
        <aside ref={sourcePanel} className={styles.sources} aria-label="Sources for latest answer">
          <Button
            variant="ghost"
            size="sm"
            className={styles.mobileSources}
            onClick={() =>
              conversation.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }
          >
            ← Back to chat
          </Button>
          <h2>Sources for this answer</h2>
          {sources.length ? (
            sources.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-3">
                  <Link
                    href={s.href}
                    target={s.href.startsWith('https:') ? '_blank' : undefined}
                    rel="noreferrer"
                    className="flex items-start justify-between gap-2 text-sm font-medium hover:underline"
                  >
                    {s.title}
                    <ExternalLink size={14} className="mt-1 shrink-0" />
                  </Link>
                  <p className={styles.sourceDetail}>{s.detail}</p>
                </CardContent>
              </Card>
            ))
          ) : (
            <p>Source records and freshness dates will appear here after a query.</p>
          )}
          <div className={styles.quickLinks}>
            <Link href={`/base/${RADIO_BASE}/radio`}>Open radio dashboard →</Link>
            <Link href={`/base/${RADIO_BASE}/releases`}>Open release workspace →</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
