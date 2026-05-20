"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Zap, Send, Bot, User, RefreshCw, Activity } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "admin" | "ai";
  content: string;
  model?: string;
  latencyMs?: number;
  timestamp: string;
}

// ─── Suggested Questions ──────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What systems are failing?",
  "Is Groq online?",
  "Show queue status",
  "Parser performance summary",
  "Recent webhook failures",
];

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isAdmin = message.role === "admin";
  const time = new Date(message.timestamp).toLocaleTimeString("en-GH", {
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={`flex gap-3 ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
        isAdmin ? "bg-primary/20" : "bg-white/[0.06]"
      }`}>
        {isAdmin
          ? <User className="h-4 w-4 text-primary" />
          : <Bot  className="h-4 w-4 text-muted-foreground" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] space-y-1 ${isAdmin ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isAdmin
            ? "bg-primary/15 text-foreground rounded-tr-sm"
            : "bg-white/[0.05] border border-white/[0.08] text-foreground rounded-tl-sm"
        }`}>
          {message.content}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-muted-foreground">{time}</span>
          {message.model && (
            <span className="text-[10px] text-muted-foreground font-mono">{message.model}</span>
          )}
          {message.latencyMs !== undefined && (
            <span className="text-[10px] text-muted-foreground">{message.latencyMs}ms</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">
        <Bot className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white/[0.05] border border-white/[0.08] px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIConsolePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  const { firebaseUser } = useAuth();

  const getToken = useCallback(async () => {
    return (await firebaseUser?.getIdToken()) ?? "";
  }, [firebaseUser]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError(null);
    setInput("");

    const adminMsg: Message = {
      id:        crypto.randomUUID(),
      role:      "admin",
      content:   trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, adminMsg]);
    setLoading(true);

    try {
      const token = await getToken();
      const res = await fetch("/api/admin/ai-console", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${token}`,
        },
        body: JSON.stringify({
          message:       trimmed,
          systemContext: "Admin requesting system status overview",
        }),
      });

      const data = await res.json() as {
        response?: string;
        model?: string;
        timestamp?: string;
        latencyMs?: number;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? "Request failed");
      }

      const aiMsg: Message = {
        id:        crypto.randomUUID(),
        role:      "ai",
        content:   data.response ?? "No response received.",
        model:     data.model !== "none" ? data.model : undefined,
        latencyMs: data.latencyMs,
        timestamp: data.timestamp ?? new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach AI console");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [getToken, loading]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <p className="text-sm text-primary">Admin Tools</p>
          <h1 className="mt-1 text-3xl font-black flex items-center gap-2">
            <Zap className="h-7 w-7 text-primary" />
            System Intelligence Console
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Groq-powered operational AI for ZURIA infrastructure
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setMessages([]); setError(null); }}
          disabled={messages.length === 0}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>

      {/* ── Chat window ── */}
      <GlassCard className="flex-1 flex flex-col min-h-0">

        {/* Message list */}
        <div className="flex-1 overflow-y-auto space-y-4 p-2 pr-1 scrollbar-thin scrollbar-thumb-white/10">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-12">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Activity className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-bold">System Intelligence ready</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ask about infrastructure health, AI performance, or parser quality.
                </p>
              </div>
              {/* Suggested questions */}
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void sendMessage(s)}
                    disabled={loading}
                    className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {loading && <TypingIndicator />}

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-white/[0.06] pt-4 mt-4 shrink-0">
          {/* Inline suggestions when messages exist */}
          {messages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void sendMessage(s)}
                  disabled={loading}
                  className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about system health, AI performance, parser quality…"
              rows={2}
              disabled={loading}
              className="flex-1 resize-none rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
            />
            <Button
              onClick={() => void sendMessage(input)}
              disabled={loading || !input.trim()}
              className="h-12 w-12 shrink-0 p-0"
            >
              {loading
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Press Enter to send · Shift+Enter for new line
          </p>
        </div>

      </GlassCard>
    </div>
  );
}
