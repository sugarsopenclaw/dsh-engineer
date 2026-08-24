import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function ProjectMarkdownPreview({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words px-3 py-3 text-slate-700 prose-headings:scroll-mt-3 prose-headings:text-slate-900 prose-a:text-sky-700 prose-code:break-words prose-code:text-[11px] prose-pre:overflow-x-auto prose-pre:bg-slate-900 prose-pre:text-[11px] prose-table:text-[11px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children }) => (
            <span className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2">
              {children}
            </span>
          ),
          img: ({ alt }) => (
            <span className="my-2 block rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-500">
              文档图片：{alt || '未命名图片'}
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
