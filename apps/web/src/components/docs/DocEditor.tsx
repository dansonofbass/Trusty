"use client";

/**
 * TipTap doc editor (agentic-ux P3) — WYSIWYG with markdown shortcuts,
 * markdown stored underneath (round-trips through tiptap-markdown so the
 * extraction pipeline keeps consuming plain text). `[[wikilinks]]` render as
 * accent inline marks via an input rule and serialize back to [[…]] — Phase 4
 * turns them into real edges + backlinks.
 */
import { useEffect } from "react";
import { EditorContent, useEditor, markInputRule } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Mark, mergeAttributes } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";

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

export default function DocEditor({
  docId,
  initialBody,
  onChange,
  placeholder,
}: {
  /** Remount key — the editor re-seeds content when the doc changes. */
  docId: string;
  initialBody: string;
  /** Debounced by the caller; receives the markdown serialization. */
  onChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write — markdown shortcuts work, [[double brackets]] link…",
      }),
      Wikilink,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: initialBody,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "doc-editor min-h-[300px] outline-none text-[14px] leading-relaxed text-ink",
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange((e.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown());
    },
  });

  // Re-seed when switching docs (the hook instance persists across doc opens).
  useEffect(() => {
    if (!editor) return;
    const current = (editor.storage as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
    if (current !== initialBody) editor.commands.setContent(initialBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, editor]);

  return <EditorContent editor={editor} />;
}
