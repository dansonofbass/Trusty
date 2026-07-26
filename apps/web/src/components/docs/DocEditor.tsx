"use client";

/**
 * TipTap doc editor (agentic-ux P3) — WYSIWYG with markdown shortcuts,
 * markdown stored underneath (round-trips through tiptap-markdown so the
 * extraction pipeline keeps consuming plain text). `[[wikilinks]]` render as
 * accent inline marks via an input rule and serialize back to [[…]] — Phase 4
 * turns them into real edges + backlinks.
 */
import { useEffect } from "react";
import { EditorContent, useEditor, markInputRule, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Mark, mergeAttributes } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, List, ListOrdered, Quote, Code, Link2,
} from "lucide-react";

/** Inline mark for [[wikilinks]]: typed as [[Target]], stored as [[Target]]. */
const Wikilink = Mark.create({
  name: "wikilink",
  inclusive: false,

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": "1",
        class: "rounded px-0.5 font-medium",
        style: "color: var(--color-accent); background: var(--color-accent-soft);",
      }),
      0,
    ];
  },

  addInputRules() {
    // "[[Anything]]" → wikilink-marked "Anything" (brackets dropped visually,
    // restored by the markdown serializer below).
    return [markInputRule({ find: /\[\[([^\[\]]+)\]\]$/, type: this.type })];
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: "[[", close: "]]", mixable: false, expelEnclosingWhitespace: true },
        parse: {
          // On load, re-mark [[…]] spans. tiptap-markdown feeds HTML through
          // this hook before parsing.
          updateDOM(element: HTMLElement) {
            element.innerHTML = element.innerHTML.replace(
              /\[\[([^\[\]<>]+)\]\]/g,
              '<span data-wikilink="1">$1</span>',
            );
          },
        },
      },
    };
  },
});

/** @person mentions — the symbol stays in the text ("@sara"), so markdown
 *  round-trips verbatim and the server's MENTION_RE sees it unchanged. */
const MentionMark = Mark.create({
  name: "docMention",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-mention": "1",
        class: "rounded px-0.5 font-medium",
        style: "color: #7aa2ff; background: rgba(122,162,255,0.12);",
      }),
      0,
    ];
  },
  addInputRules() {
    // Marks "@name" (symbol included) as it's typed. Lookbehind keeps the
    // word boundary OUT of the match — markInputRule deletes match text
    // outside the capture group, and we must not eat the user's space.
    return [markInputRule({ find: /(?<=^|\s)(@[\p{L}\d][\p{L}\d_-]+)$/u, type: this.type })];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "", mixable: false },
        parse: {
          updateDOM(element: HTMLElement) {
            element.innerHTML = element.innerHTML.replace(
              /(^|[\s(>])(@[\p{L}\d][\p{L}\d_-]{1,40})/gu,
              '$1<span data-mention="1">$2</span>',
            );
          },
        },
      },
    };
  },
});

/** #concept tags — same contract as @mentions, concept-colored. */
const TagMark = Mark.create({
  name: "docTag",
  inclusive: false,
  parseHTML() {
    return [{ tag: "span[data-tag]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-tag": "1",
        class: "rounded px-0.5 font-medium",
        style: "color: #54d26e; background: rgba(84,210,110,0.12);",
      }),
      0,
    ];
  },
  addInputRules() {
    return [markInputRule({ find: /(?<=^|\s)(#[\p{L}\d][\p{L}\d_-]+)$/u, type: this.type })];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: "", close: "", mixable: false },
        parse: {
          updateDOM(element: HTMLElement) {
            element.innerHTML = element.innerHTML.replace(
              /(^|[\s(>])(#[\p{L}\d][\p{L}\d_-]{1,40})/gu,
              '$1<span data-tag="1">$2</span>',
            );
          },
        },
      },
    };
  },
});

export default function DocEditor({
  docId,
  initialBody,
  onChange,
  onWikilinkClick,
  placeholder,
}: {
  /** Remount key — the editor re-seeds content when the doc changes. */
  docId: string;
  initialBody: string;
  /** Debounced by the caller; receives the markdown serialization. */
  onChange: (markdown: string) => void;
  /** Clicking a [[wikilink]] span passes its text (navigation is the caller's). */
  onWikilinkClick?: (name: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write — markdown shortcuts work, [[double brackets]] link…",
      }),
      Wikilink,
      MentionMark,
      TagMark,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: initialBody,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "doc-editor min-h-[300px] outline-none text-[14px] leading-relaxed text-ink",
      },
      // Click a wikilink span → navigate to its target (caller resolves).
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        const el = event.target as HTMLElement | null;
        const linked = el?.closest?.("[data-wikilink],[data-mention],[data-tag]");
        if (linked && onWikilinkClick) {
          // Strip the @/# symbol — the caller resolves bare names.
          const raw = node.text ?? linked.textContent ?? "";
          onWikilinkClick(raw.replace(/^[@#]/, ""));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange((e.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
    },
  });

  // Re-seed when switching docs OR when the body changes outside the editor
  // (post-weave auto-linking). While typing, onChange keeps the parent body
  // equal to the editor's markdown, so this stays a no-op.
  useEffect(() => {
    if (!editor) return;
    const current = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
    if (current !== initialBody) editor.commands.setContent(initialBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor, initialBody]);

  return (
    <div className="rounded-xl border border-[var(--color-line)] transition focus-within:border-[var(--color-accent-line)]">
      <Toolbar editor={editor} />
      {/* Whole surface is a click target — clicking below the text focuses. */}
      <div
        className="min-h-[52vh] cursor-text px-4 py-3"
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const btn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    isActive: boolean,
  ) => (
    <button
      key={label}
      type="button"
      title={label}
      onMouseDown={(e) => {
        e.preventDefault(); // keep editor selection/focus
        onClick();
      }}
      className="rounded-md p-1.5 transition"
      style={
        isActive
          ? { background: "var(--color-accent-soft)", color: "var(--color-accent)" }
          : { color: "var(--color-faint)" }
      }
    >
      {icon}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-line)] px-2 py-1">
      {btn("Bold (⌘B)", <Bold size={14} />, () => c().toggleBold().run(), editor.isActive("bold"))}
      {btn("Italic (⌘I)", <Italic size={14} />, () => c().toggleItalic().run(), editor.isActive("italic"))}
      {btn("Strikethrough", <Strikethrough size={14} />, () => c().toggleStrike().run(), editor.isActive("strike"))}
      <span className="mx-1 h-4 w-px bg-[var(--color-line)]" />
      {btn("Heading 1", <Heading1 size={14} />, () => c().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }))}
      {btn("Heading 2", <Heading2 size={14} />, () => c().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
      <span className="mx-1 h-4 w-px bg-[var(--color-line)]" />
      {btn("Bullet list", <List size={14} />, () => c().toggleBulletList().run(), editor.isActive("bulletList"))}
      {btn("Numbered list", <ListOrdered size={14} />, () => c().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {btn("Quote", <Quote size={14} />, () => c().toggleBlockquote().run(), editor.isActive("blockquote"))}
      {btn("Code block", <Code size={14} />, () => c().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
      <span className="mx-1 h-4 w-px bg-[var(--color-line)]" />
      {btn("Wikilink — or type [[…]]", <Link2 size={14} />, () => {
        const sel = editor.state.selection;
        const text = editor.state.doc.textBetween(sel.from, sel.to) || "link";
        c().insertContent(`[[${text}]] `).run();
      }, editor.isActive("wikilink"))}
      <span className="ml-auto pr-1 text-[10px] text-[var(--color-faint)]">
        markdown shortcuts &amp; [[wikilinks]] work while typing
      </span>
    </div>
  );
}
